import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { PATHS } from "../../../lib/config";

const META_FILE = path.join(PATHS.metaDir, "harvest_meta.json");

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

export async function GET() {
  const meta = readMeta();
  return Response.json({ meta });
}

export async function POST(request: Request) {
  const meta = readMeta();
  if (meta.running) {
    return Response.json({ ok: false, error: "A harvest is already in progress." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const hours: number = Math.max(1, Math.min(168, Number(body.hours) || 48));

  const scriptPath = path.join(process.cwd(), "scripts", "harvest_proposals.py");
  if (!fs.existsSync(scriptPath)) {
    return Response.json({ error: "harvest_proposals.py not found in scripts/" }, { status: 500 });
  }

  // Mark as running before spawning so any page reload sees it immediately
  writeMeta({ ...meta, running: true, started_at: new Date().toISOString(), running_hours: hours });

  const started = Date.now();

  return new Promise<Response>((resolve) => {
    const args = ["scripts/harvest_proposals.py", "--submit", "--since", `${hours}h`];
    const proc = execFile(
      "python3",
      args,
      { cwd: process.cwd(), timeout: 120_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const duration_ms = Date.now() - started;
        const combined = (stdout + "\n" + stderr).trim();
        const lines = combined.split("\n").filter(Boolean);
        const tail = lines.slice(-20);

        if (err && !stdout) {
          writeMeta({ ...readMeta(), running: false });
          resolve(Response.json({ ok: false, error: err.message, output: tail }, { status: 500 }));
          return;
        }

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
      },
    );

    proc.on("error", (err) => {
      writeMeta({ ...readMeta(), running: false });
      resolve(Response.json({ ok: false, error: err.message }, { status: 500 }));
    });
  });
}
