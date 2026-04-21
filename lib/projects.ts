import fs from "fs";
import path from "path";
import { PATHS } from "./config";
import { readJsonlWithWarnings } from "./jsonl";
import { getDb, parseDecisionRow } from "./db";

export const PROJECTS_PATH = path.join(process.cwd(), "projects.json");
export const META_DIR = PATHS.metaDir;

export type ProjectConfig = {
  slug: string;
  name: string;
  color: string;
  description: string;
  context_keys: string[];
  agents?: string[];
  status?: string;
};

const g = global as typeof global & {
  __govinuity_projects_cache?: { mtimeMs: number; projects: ProjectConfig[] };
};

export function readJsonl(filepath: string) {
  return readJsonlWithWarnings(filepath, filepath).entries;
}

export function getProjects(): ProjectConfig[] {
  if (!fs.existsSync(PROJECTS_PATH)) return [];
  const mtimeMs = fs.statSync(PROJECTS_PATH).mtimeMs;
  const cached = g.__govinuity_projects_cache;
  if (cached && cached.mtimeMs === mtimeMs) return cached.projects;

  const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf-8")) as ProjectConfig[];
  g.__govinuity_projects_cache = { mtimeMs, projects };
  return projects;
}

export function getProjectBySlug(slug: string) {
  return getProjects().find((project) => project.slug === slug) ?? null;
}

export function contextMatchesProject(context: string | undefined, project: ProjectConfig) {
  if (!context) return false;
  return project.context_keys.some((key) => context === key || context.startsWith(`${key}:`));
}

export function inferProjectFromContext(context: string | undefined, projects = getProjects()) {
  if (!context) return null;
  return projects.find((project) => contextMatchesProject(context, project))?.slug ?? null;
}

export function resolveProjectSlug<T extends { project?: string | null; context?: string; original_entry?: { context?: string } }>(entry: T, projects = getProjects()) {
  if (entry.project) return entry.project;
  const context = entry.context ?? entry.original_entry?.context;
  return inferProjectFromContext(context, projects);
}

export function withResolvedProject<T extends { project?: string | null; context?: string; original_entry?: { context?: string } }>(entry: T, projects = getProjects()) {
  return {
    ...entry,
    project: resolveProjectSlug(entry, projects),
  };
}

export function belongsToProject<T extends { project?: string | null; context?: string; original_entry?: { context?: string } }>(entry: T, project: ProjectConfig) {
  const resolvedProject = resolveProjectSlug(entry);
  if (resolvedProject) return resolvedProject === project.slug;
  const context = entry.context ?? entry.original_entry?.context;
  return contextMatchesProject(context, project);
}

export function filterByProject<T extends { project?: string | null; context?: string; original_entry?: { context?: string } }>(entries: T[], project: ProjectConfig) {
  return entries.filter((entry) => belongsToProject(entry, project));
}

function readFeedbackEntries() {
  return readJsonl(path.join(META_DIR, "feedback.jsonl"));
}

function buildContextMatchers(columnExpr: string, contextKeys: string[]) {
  const clauses: string[] = [];
  const args: string[] = [];

  for (const key of contextKeys) {
    clauses.push(`${columnExpr} = ?`);
    args.push(key);
    clauses.push(`${columnExpr} LIKE ?`);
    args.push(`${key}:%`);
  }

  return { clauses, args };
}

function parseReviewRow(row: Record<string, any>) {
  return {
    ...row,
    reviewed: row.reviewed === 1,
    original_entry: typeof row.original_entry === "string" ? JSON.parse(row.original_entry) : row.original_entry,
  } as Record<string, any>;
}

function aggregateProjectFromFeedback(project: ProjectConfig, feedbackEntries: Record<string, any>[]) {
  const db = getDb();
  const feedback = filterByProject(feedbackEntries, project);

  const decisionContext = buildContextMatchers("context", project.context_keys);
  const decisionWhere = [
    "project_id = ?",
    ...decisionContext.clauses,
  ].join(" OR ");
  const decisionArgs: string[] = [project.slug, ...decisionContext.args];
  const decisionRows = db.prepare(`
    SELECT *
    FROM decisions
    WHERE ${decisionWhere}
    ORDER BY created_at DESC
  `).all(...decisionArgs) as Record<string, any>[];
  const decisions = decisionRows.map(parseDecisionRow);

  const reviewContext = buildContextMatchers("json_extract(original_entry, '$.context')", project.context_keys);
  const reviewWhere = [
    "project = ?",
    ...reviewContext.clauses,
  ].join(" OR ");
  const reviewArgs: string[] = [project.slug, ...reviewContext.args];
  const review = (db.prepare(`
    SELECT *
    FROM review_queue
    WHERE ${reviewWhere}
    ORDER BY created_at DESC
  `).all(...reviewArgs) as Record<string, any>[]).map(parseReviewRow);

  const pendingReview = review.filter((item) => !item.reviewed);
  const openFollowUps = decisions.filter((entry) => (entry.follow_up_state ?? "open") === "open");

  const lastActivityTs = [
    ...feedback.map((e) => e.ts),
    ...decisions.map((e) => e.ts),
    ...review.map((e) => e.ts),
  ]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    project,
    counts: {
      feedback: feedback.length,
      decisions: decisions.length,
      review: review.length,
      pendingReview: pendingReview.length,
      openFollowUps: openFollowUps.length,
    },
    lastActivityTs,
    samples: {
      recentFeedback: feedback.slice(-5).reverse(),
      recentDecisions: decisions.slice(-5).reverse(),
      pendingReview: pendingReview.slice(0, 5),
      openFollowUps: openFollowUps.slice(-5).reverse(),
    },
  };
}

export function aggregateProject(project: ProjectConfig) {
  return aggregateProjectFromFeedback(project, readFeedbackEntries());
}

export function aggregateProjects(projects: ProjectConfig[]) {
  const feedbackEntries = readFeedbackEntries();
  return projects.map((project) => aggregateProjectFromFeedback(project, feedbackEntries));
}
