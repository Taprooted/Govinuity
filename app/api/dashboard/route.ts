import fs from "fs";
import path from "path";
import { getDb, parseDecisionRow } from "../../../lib/db";
import { PATHS } from "../../../lib/config";
import { filterByProject, getProjectBySlug, withResolvedProject } from "../../../lib/projects";

type HarvestMeta = {
  running: boolean;
  started_at?: string;
  running_hours?: number;
  last_run_ts?: string;
  last_run_hours?: number;
  last_submitted?: number;
  last_annotations?: number;
  last_duration_ms?: number;
  last_output_tail?: string[];
};

const HARVEST_META_PATH = path.join(PATHS.metaDir, "harvest_meta.json");

function readHarvestMeta(): HarvestMeta {
  try {
    return JSON.parse(fs.readFileSync(HARVEST_META_PATH, "utf8"));
  } catch {
    return { running: false };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectSlug = searchParams.get("project");
  const project = projectSlug ? getProjectBySlug(projectSlug) : null;
  const db = getDb();

  const now = new Date();
  const ts7d = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const ts14d = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const ts30d = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const projectFilter = project ? "AND project = ?" : "";
  const decisionFilter = project ? "AND project_id = ?" : "";
  const projectArgs = project ? [project.slug] : [];

  const pendingRows = (db.prepare(`
    SELECT reviewed, project, original_entry, created_at
    FROM review_queue
    WHERE reviewed = 0
    ORDER BY created_at DESC
  `).all() as Record<string, any>[]).map((row) => ({
    ...row,
    reviewed: row.reviewed === 1,
    original_entry: typeof row.original_entry === "string" ? JSON.parse(row.original_entry) : row.original_entry,
  }));

  const pendingItems = project ? filterByProject(pendingRows.map((item) => withResolvedProject(item)), project) : pendingRows;
  const pendingReview = pendingItems.length;

  const highPriorityReview = pendingItems.filter((item) => item.original_entry?.severity === "high").length;

  const ratifiedCount = (db.prepare(`
    SELECT COUNT(*) as n
    FROM decisions
    WHERE status = 'approved' ${decisionFilter}
  `).get(...projectArgs) as { n: number }).n;

  const recentDecisionRows = db.prepare(`
    SELECT id, title, body, summary_for_human, proposal_class, created_at
    FROM decisions
    WHERE status = 'approved' ${decisionFilter}
    ORDER BY created_at DESC
    LIMIT 4
  `).all(...projectArgs) as Record<string, unknown>[];
  const recentDecisions = recentDecisionRows.map((row) => parseDecisionRow(row) as Record<string, unknown>);

  const decisionPulse = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE follow_up_state = 'open') AS open_follow_ups
    FROM decisions
    WHERE 1 = 1 ${decisionFilter}
  `).get(...projectArgs) as { total: number; open_follow_ups: number };

  const runs7d = (db.prepare(
    `SELECT COUNT(*) as n FROM continuity_runs WHERE ts >= ? ${projectFilter}`
  ).get(ts7d, ...projectArgs) as { n: number }).n;

  const runs30d = (db.prepare(
    `SELECT COUNT(*) as n FROM continuity_runs WHERE ts >= ? ${projectFilter}`
  ).get(ts30d, ...projectArgs) as { n: number }).n;

  const injAvg = db.prepare(`
    SELECT
      AVG(injected_count) AS avg_inj,
      AVG(excluded_count) AS avg_exc,
      AVG(duration_ms) AS avg_dur,
      AVG(total_eligible) AS avg_elig
    FROM continuity_runs
    WHERE ts >= ? ${projectFilter}
  `).get(ts30d, ...projectArgs) as {
    avg_inj: number | null;
    avg_exc: number | null;
    avg_dur: number | null;
    avg_elig: number | null;
  };

  const exclusionRows = db.prepare(`
    SELECT json_extract(e.value, '$.reason') AS reason, COUNT(*) AS n
    FROM continuity_runs r, json_each(r.excluded) e
    WHERE r.ts >= ? ${projectFilter}
    GROUP BY reason
    ORDER BY n DESC
  `).all(ts30d, ...projectArgs) as { reason: string | null; n: number }[];

  const utilizationRows = db.prepare(`
    SELECT d_id.value AS decision_id,
           dec.title  AS title,
           COUNT(*)   AS injection_count
    FROM continuity_runs r, json_each(r.injected_ids) d_id
    LEFT JOIN decisions dec ON dec.id = d_id.value
    WHERE r.ts >= ? ${projectFilter}
    GROUP BY d_id.value
    ORDER BY injection_count DESC
    LIMIT 15
  `).all(ts30d, ...projectArgs) as {
    decision_id: string;
    title: string | null;
    injection_count: number;
  }[];

  const runsByDayRows = db.prepare(`
    SELECT substr(ts, 1, 10) AS date, COUNT(*) AS n
    FROM continuity_runs
    WHERE ts >= ? ${projectFilter}
    GROUP BY date
    ORDER BY date ASC
  `).all(ts14d, ...projectArgs) as { date: string; n: number }[];

  const runsByDay: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    const date = d.toISOString().slice(0, 10);
    const row = runsByDayRows.find((entry) => entry.date === date);
    runsByDay.push({ date, count: row?.n ?? 0 });
  }

  const decisionHealth = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'approved')   AS approved,
      COUNT(*) FILTER (WHERE status = 'proposed')   AS proposed,
      COUNT(*) FILTER (WHERE status = 'deferred')   AS deferred,
      COUNT(*) FILTER (WHERE status = 'superseded') AS superseded
    FROM decisions
    WHERE 1 = 1 ${decisionFilter}
  `).get(...projectArgs) as { approved: number; proposed: number; deferred: number; superseded: number };

  const annotationRows = db.prepare(`
    SELECT ra.annotation_type AS annotation_type, COUNT(*) AS n
    FROM run_annotations ra
    ${project ? "JOIN continuity_runs r ON r.run_id = ra.run_id" : ""}
    WHERE ra.value = 1
    ${project ? "AND r.project = ?" : ""}
    GROUP BY ra.annotation_type
  `).all(...projectArgs) as { annotation_type: string; n: number }[];

  const annotationsByType = Object.fromEntries(annotationRows.map((row) => [row.annotation_type, row.n]));

  return Response.json({
    pendingReview,
    ratifiedCount,
    recentDecisions,
    harvestMeta: readHarvestMeta(),
    pulse: {
      pendingReview,
      decisions: decisionPulse.total,
      openFollowUps: decisionPulse.open_follow_ups,
      highPriorityReview,
      urgency: highPriorityReview > 0 ? "high" : pendingReview > 0 || decisionPulse.open_follow_ups > 0 ? "medium" : "low",
    },
    metrics: {
      runs: {
        last_7d: runs7d,
        last_30d: runs30d,
      },
      averages: {
        injected_per_run: injAvg.avg_inj != null ? Math.round(injAvg.avg_inj * 10) / 10 : null,
        excluded_per_run: injAvg.avg_exc != null ? Math.round(injAvg.avg_exc * 10) / 10 : null,
        duration_ms: injAvg.avg_dur != null ? Math.round(injAvg.avg_dur) : null,
        eligible_per_run: injAvg.avg_elig != null ? Math.round(injAvg.avg_elig * 10) / 10 : null,
      },
      exclusion_reasons: Object.fromEntries(
        exclusionRows
          .filter((row): row is { reason: string; n: number } => Boolean(row.reason))
          .map((row) => [row.reason, row.n]),
      ),
      decision_utilization: utilizationRows,
      runs_by_day: runsByDay,
      decision_health: decisionHealth,
    },
    annotationsByType,
  });
}
