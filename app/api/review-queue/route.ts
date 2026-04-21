import { getDb } from "../../../lib/db";
import { internalServerError } from "../../../lib/api-errors";
import { applyReviewDecision } from "../../../lib/review-write";
import { filterByProject, getProjectBySlug, withResolvedProject } from "../../../lib/projects";

const MAX_QUERY_LIMIT = 500;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectSlug = searchParams.get("project");
  const requestedLimit = parseInt(searchParams.get("limit") ?? "500", 10) || 500;
  const limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, requestedLimit));

  const db = getDb();
  const project = projectSlug ? getProjectBySlug(projectSlug) : null;

  if (!projectSlug || project) {
    let sql = "SELECT * FROM review_queue";
    const params: unknown[] = [];

    if (project) {
      sql += " WHERE project = ?";
      params.push(project.slug);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const items = (db.prepare(sql).all(...params) as Record<string, any>[])
      .map((row) => ({
        ...row,
        reviewed: row.reviewed === 1,
        original_entry: typeof row.original_entry === "string" ? JSON.parse(row.original_entry) : row.original_entry,
      }))
      .map((item) => withResolvedProject(item));

    return Response.json({ items, warnings: [] });
  }

  const rows = db.prepare("SELECT * FROM review_queue ORDER BY created_at DESC").all() as Record<string, any>[];

  let items = rows.map((row) => ({
    ...row,
    reviewed: row.reviewed === 1,
    original_entry: typeof row.original_entry === "string" ? JSON.parse(row.original_entry) : row.original_entry,
  })).map((item) => withResolvedProject(item));

  if (projectSlug) {
    items = [];
  }

  return Response.json({ items: items.slice(0, limit), warnings: [] });
}

export async function POST(request: Request) {
  const { id, decision, note } = await request.json();

  try {
    const result = applyReviewDecision({ id, decision, note, reviewedBy: "user" });
    return Response.json(result);
  } catch (error) {
    return internalServerError(error);
  }
}
