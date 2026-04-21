import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const pendingReview = (db.prepare(
    "SELECT COUNT(*) AS n FROM review_queue WHERE reviewed = 0",
  ).get() as { n: number }).n;

  const highPriorityReview = (db.prepare(`
    SELECT COUNT(*) AS n
    FROM review_queue
    WHERE reviewed = 0
      AND json_extract(original_entry, '$.severity') = 'high'
  `).get() as { n: number }).n;

  const decisionCounts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE follow_up_state = 'open') AS open_follow_ups,
      COUNT(*) FILTER (WHERE status = 'proposed') AS proposed,
      COUNT(*) FILTER (WHERE status = 'approved') AS approved
    FROM decisions
  `).get() as { total: number; open_follow_ups: number; proposed: number; approved: number };

  const totalRuns = (db.prepare("SELECT COUNT(*) as n FROM continuity_runs").get() as { n: number }).n;

  return Response.json({
    counts: {
      home: pendingReview,
      review: pendingReview,
      proposals: decisionCounts.proposed,
      decisions_total: decisionCounts.approved,
      runs: totalRuns,
    },
    pulse: {
      pendingReview,
      decisions: decisionCounts.total,
      openFollowUps: decisionCounts.open_follow_ups,
      highPriorityReview,
      urgency: highPriorityReview > 0 ? "high" : pendingReview > 0 || decisionCounts.open_follow_ups > 0 ? "medium" : "low",
    },
  });
}
