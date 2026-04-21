import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { PATHS } from "../../../lib/config";

const META_FILE = path.join(/* turbopackIgnore: true */ PATHS.metaDir, "harvest_meta.json");
const PROJECT_ROOT = /* turbopackIgnore: true */ process.cwd();

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

type SourcePreset = "current" | "parent" | "all" | "custom";
type ArtifactType = "transcript" | "handoff_summary" | "correction_or_lesson" | "subagent_report" | "working_notes";

const ARTIFACT_TYPES = new Set<ArtifactType>([
  "transcript",
  "handoff_summary",
  "correction_or_lesson",
  "subagent_report",
  "working_notes",
]);

function readMeta(): HarvestMeta {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  } catch {
    return { running: false };
  }
}

function writeMeta(meta: HarvestMeta) {
  fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function parseOutput(output: string): { submitted: number; annotations: number } {
  let submitted = 0;
  let annotations = 0;
  const subMatch = output.match(/Submitted (\d+)\/\d+ candidates/);
  if (subMatch) submitted = parseInt(subMatch[1], 10);
  const annotMatch = output.match(/Submitted (\d+) annotation/);
  if (annotMatch) annotations = parseInt(annotMatch[1], 10);
  return { submitted, annotations };
}

const PYTHON_BIN = process.env.GOVINUITY_PYTHON_BIN || "python3";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeHarvestOutputLine(line: string): string {
  let sanitized = line;

  if (HOME) {
    sanitized = sanitized.replace(
      new RegExp(`${escapeRegExp(HOME)}/\\.claude/projects/\\S+`, "g"),
      "~/.claude/projects/<project>",
    );
  }
  sanitized = sanitized.replace(new RegExp(escapeRegExp(PROJECT_ROOT), "g"), "<repo>");
  if (HOME) sanitized = sanitized.replace(new RegExp(escapeRegExp(HOME), "g"), "~");

  return sanitized;
}

function harvestOutputTail(output: string): string[] {
  return output
    .split("\n")
    .filter(Boolean)
    .slice(-20)
    .map(sanitizeHarvestOutputLine);
}

function runScript(args: string[], stdin?: string, env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args, {
      cwd: PROJECT_ROOT,
      timeout: 600_000,
      env: env ?? process.env,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    if (stdin !== undefined) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on("close", (code, signal) => {
      if (signal) {
        const combined = (stdout + "\n" + stderr).trim();
        const tail = harvestOutputTail(combined).slice(-12).join("\n");
        reject(new Error(tail || `Harvest script was terminated by ${signal}`));
        return;
      }
      if (code && code !== 0) {
        const combined = (stdout + "\n" + stderr).trim();
        const tail = harvestOutputTail(combined).slice(-12).join("\n");
        reject(new Error(tail || `Harvest script exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    proc.on("error", reject);
  });
}

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";

function claudeProjectDirFor(projectPath: string): string {
  const resolved = path.isAbsolute(projectPath) ? projectPath : path.join(/* turbopackIgnore: true */ PROJECT_ROOT, projectPath);
  return path.join(/* turbopackIgnore: true */ HOME, ".claude", "projects", resolved.replace(/[^A-Za-z0-9_-]/g, "-"));
}

function allClaudeProjectsDir(): string {
  return path.join(/* turbopackIgnore: true */ HOME, ".claude", "projects");
}

function defaultSessionDir(): string {
  const configured = process.env.GOVINUITY_SESSION_DIR;
  if (configured) return configured;

  const currentProjectDir = claudeProjectDirFor(PROJECT_ROOT);
  if (fs.existsSync(currentProjectDir)) return currentProjectDir;

  return allClaudeProjectsDir();
}

function tildify(p: string): string {
  if (HOME && p.startsWith(HOME)) return "~" + p.slice(HOME.length);
  return p;
}

function expandHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(/* turbopackIgnore: true */ HOME, p.slice(2));
  return p;
}

function resolveSessionDir(preset: SourcePreset, customDir?: string): string {
  if (preset === "custom" && customDir?.trim()) return expandHome(customDir.trim());
  if (preset === "parent") return claudeProjectDirFor(path.dirname(PROJECT_ROOT));
  if (preset === "all") return allClaudeProjectsDir();
  return defaultSessionDir();
}

function sourceOptions() {
  return [
    {
      id: "current",
      label: "Current project sessions",
      description: "Narrowest scan. Best when the agent worked inside this repo.",
      sessionDir: tildify(defaultSessionDir()),
      recommended: true,
    },
    {
      id: "parent",
      label: "Parent folder sessions",
      description: "Useful when the agent worked from the parent workspace. May include adjacent projects.",
      sessionDir: tildify(claudeProjectDirFor(path.dirname(PROJECT_ROOT))),
      warning: "May include unrelated project work.",
    },
    {
      id: "all",
      label: "All Claude Code sessions",
      description: "Broad scan across Claude Code project folders. Highest recall, highest noise.",
      sessionDir: tildify(allClaudeProjectsDir()),
      warning: "Broad scan. Use only when you intentionally want cross-project candidates.",
    },
    {
      id: "custom",
      label: "Custom directory",
      description: "Use another JSONL session export directory.",
      sessionDir: "",
    },
  ];
}

function isHarvestGeneratedSession(filePath: string): boolean {
  const markers = [
    "You are a continuity-extraction assistant for a governed decision memory system.",
    "You are reviewing a Claude Code session transcript to detect continuity outcome signals.",
  ];
  try {
    const fd = fs.openSync(/* turbopackIgnore: true */ filePath, "r");
    const buffer = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const sample = buffer.subarray(0, bytes).toString("utf8");
    return markers.some((marker) => sample.includes(marker));
  } catch {
    return false;
  }
}

type SessionFileStat = {
  path: string;
  mtimeMs: number;
  generated: boolean;
};

function collectJsonlFileStats(dir: string): SessionFileStat[] {
  if (!fs.existsSync(/* turbopackIgnore: true */ dir)) return [];
  const entries = fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true });
  const files = new Map<string, SessionFileStat>();

  const addFile = (filePath: string) => {
    if (!filePath.endsWith(".jsonl") || files.has(filePath)) return;
    try {
      const stat = fs.statSync(/* turbopackIgnore: true */ filePath);
      files.set(filePath, {
        path: filePath,
        mtimeMs: stat.mtimeMs,
        generated: isHarvestGeneratedSession(filePath),
      });
    } catch {
      // Ignore unreadable files.
    }
  };

  for (const entry of entries) {
    const full = path.join(/* turbopackIgnore: true */ dir, entry.name);
    if (entry.isFile()) addFile(full);
    if (entry.isDirectory()) {
      try {
        for (const child of fs.readdirSync(/* turbopackIgnore: true */ full, { withFileTypes: true })) {
          if (child.isFile()) addFile(path.join(/* turbopackIgnore: true */ full, child.name));
        }
      } catch {
        // Ignore unreadable project folders.
      }
    }
  }

  return Array.from(files.values());
}

function preflightSessionDir(sessionDir: string, preset: SourcePreset) {
  const resolved = expandHome(sessionDir);
  const exists = fs.existsSync(/* turbopackIgnore: true */ resolved);
  const files = exists ? collectJsonlFileStats(resolved) : [];
  let usableCount = 0;
  let generatedCount = 0;
  let newestUsable: SessionFileStat | null = null;

  for (const file of files) {
    if (file.generated) {
      generatedCount += 1;
      continue;
    }
    usableCount += 1;
    if (!newestUsable || file.mtimeMs > newestUsable.mtimeMs) newestUsable = file;
  }

  const warnings: string[] = [];

  if (!exists) warnings.push("This directory does not exist.");
  if (exists && usableCount === 0 && generatedCount > 0) warnings.push("Only harvest-generated sessions were found.");
  if (exists && files.length === 0) warnings.push("No JSONL session files were found.");
  if (preset === "parent") warnings.push("This source may include adjacent projects from the parent folder.");
  if (preset === "all") warnings.push("This is a broad scan and may include unrelated project work.");

  return {
    exists,
    resolved: tildify(resolved),
    totalFiles: files.length,
    usableFiles: usableCount,
    harvestGeneratedFiles: generatedCount,
    newestUsableFile: newestUsable ? path.basename(newestUsable.path) : null,
    newestUsableAt: newestUsable ? new Date(newestUsable.mtimeMs).toISOString() : null,
    warnings,
  };
}

export async function GET(request: Request) {
  const meta = readMeta();
  const { searchParams } = new URL(request.url);
  const preset = (searchParams.get("sourcePreset") ?? "current") as SourcePreset;
  const customDir = searchParams.get("sessionDir") ?? undefined;
  if (searchParams.get("preflight") === "true") {
    const sessionDir = resolveSessionDir(preset, customDir);
    return Response.json({ preflight: preflightSessionDir(sessionDir, preset), sources: sourceOptions() });
  }
  const sessionDir = tildify(defaultSessionDir());
  return Response.json({ meta, sessionDir, sources: sourceOptions() });
}

export async function POST(request: Request) {
  const meta = readMeta();
  if (meta.running) {
    return Response.json({ ok: false, error: "A harvest is already in progress." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));

  // mode: "sessions" (auto-scan) | "text" (paste via stdin)
  const mode: string = body.mode ?? "sessions";
  const hours: number = Math.max(1, Math.min(168, Number(body.hours) || 48));
  const text: string | undefined = typeof body.text === "string" ? body.text : undefined;
  const source: string = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "paste";
  const artifactType: ArtifactType = ARTIFACT_TYPES.has(body.artifactType) ? body.artifactType : "transcript";
  const sessionDir: string | undefined = typeof body.sessionDir === "string" && body.sessionDir.trim() ? body.sessionDir.trim() : undefined;
  const sourcePreset: SourcePreset = ["current", "parent", "all", "custom"].includes(body.sourcePreset) ? body.sourcePreset : "current";
  const ignoreWatermark: boolean = Boolean(body.ignoreWatermark);
  const maxFiles: number = Math.max(1, Math.min(100, Number(body.maxFiles) || 25));
  const scriptEnv = { ...process.env, GOVINUITY_URL: process.env.GOVINUITY_URL || new URL(request.url).origin };

  const scriptPath = path.join(/* turbopackIgnore: true */ PROJECT_ROOT, "scripts", "harvest_proposals.py");
  if (!fs.existsSync(scriptPath)) {
    return Response.json({ error: "harvest_proposals.py not found in scripts/" }, { status: 500 });
  }

  if (mode === "text") {
    if (!text?.trim()) {
      return Response.json({ error: "No text provided." }, { status: 400 });
    }
    // Text input is fast and synchronous — no need for running flag
    const started = Date.now();
    try {
      const { stdout, stderr } = await runScript(
        ["scripts/harvest_proposals.py", "--submit", "--input", "-", "--source", source, "--artifact-type", artifactType],
        text,
        scriptEnv,
      );
      const duration_ms = Date.now() - started;
      const combined = (stdout + "\n" + stderr).trim();
      const tail = harvestOutputTail(combined);
      const { submitted, annotations } = parseOutput(combined);
      return Response.json({ ok: true, submitted, annotations, duration_ms, output: tail });
    } catch (err: unknown) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : "Script error" }, { status: 500 });
    }
  }

  // sessions mode — mark running, spawn async
  writeMeta({ ...meta, running: true, started_at: new Date().toISOString(), running_hours: hours });
  const started = Date.now();

  const env = { ...scriptEnv, GOVINUITY_SESSION_DIR: resolveSessionDir(sourcePreset, sessionDir) };
  const args = ["scripts/harvest_proposals.py", "--submit", "--since", `${hours}h`, "--max-files", String(maxFiles)];
  if (ignoreWatermark) args.push("--no-watermark");

  return new Promise<Response>((resolve) => {
    runScript(args, undefined, env)
      .then(({ stdout, stderr }) => {
        const duration_ms = Date.now() - started;
        const combined = (stdout + "\n" + stderr).trim();
        const tail = harvestOutputTail(combined);
        const { submitted, annotations } = parseOutput(combined);
        writeMeta({
          running: false,
          last_run_ts: new Date().toISOString(),
          last_run_hours: hours,
          last_submitted: submitted,
          last_annotations: annotations,
          last_duration_ms: duration_ms,
          last_output_tail: tail,
        });
        resolve(Response.json({ ok: true, submitted, annotations, duration_ms, output: tail }));
      })
      .catch((err: Error) => {
        writeMeta({ ...readMeta(), running: false });
        resolve(Response.json({ ok: false, error: err.message }, { status: 500 }));
      });
  });
}
