"use client";

import { useEffect, useState } from "react";
import { PageHeader, ProjectBar } from "../components/ui";
import { timeAgo } from "../../lib/utils";
import type { ContinuityRunRecord } from "../../lib/run-log";
import type { RunAnnotation, AnnotationType } from "../../lib/annotation-log";

const ANNOTATION_CONFIG: {
  type: AnnotationType;
  label: string;
  tone: "amber" | "red" | "green";
}[] = [
  { type: "context_restatement_required", label: "Context restated",    tone: "amber" },
  { type: "continuity_correction_required", label: "Correction required", tone: "amber" },
  { type: "stale_leakage_detected",        label: "Stale leakage",       tone: "red"   },
  { type: "approved_decision_followed",    label: "Decision followed",    tone: "green" },
  { type: "approved_decision_not_followed", label: "Decision not followed", tone: "red" },
];

const TONE_CLASS = {
  amber: {
    idle: "border-amber-800/50 text-amber-500/70 hover:border-amber-600 hover:text-amber-400",
    active: "border-amber-600 bg-amber-950/40 text-amber-300",
  },
  red: {
    idle: "border-red-800/50 text-red-500/70 hover:border-red-600 hover:text-red-400",
    active: "border-red-600 bg-red-950/40 text-red-300",
  },
  green: {
    idle: "border-green-800/50 text-green-500/70 hover:border-green-600 hover:text-green-400",
    active: "border-green-600 bg-green-950/40 text-green-300",
  },
};

function RunCard({
  run,
  annotations,
  onAnnotated,
}: {
  run: ContinuityRunRecord;
  annotations: RunAnnotation[];
  onAnnotated: (runId: string, newAnnotations: RunAnnotation[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAnnotate, setShowAnnotate] = useState(false);
  const [selected, setSelected] = useState<Set<AnnotationType>>(new Set());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const existingTypes = new Set(annotations.map((a) => a.annotation_type));

  function toggle(type: AnnotationType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setSaving(true);
    const created: RunAnnotation[] = [];
    for (const annotation_type of selected) {
      const res = await fetch("/api/run-annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: run.run_id,
          annotation_type,
          value: true,
          note: note.trim() || null,
        }),
      });
      if (res.ok) {
        const { annotation } = await res.json();
        created.push(annotation);
      }
    }
    setSaving(false);
    setSelected(new Set());
    setNote("");
    onAnnotated(run.run_id, created);
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-[var(--muted)] font-mono">{run.run_id.slice(0, 18)}…</span>
          {run.project && (
            <span className="text-xs rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">
              {run.project}
            </span>
          )}
          {run.source && (
            <span className="text-xs text-[var(--muted)]">{run.source}</span>
          )}
          <span className="ml-auto text-xs text-[var(--muted)]">{timeAgo(run.ts)}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-4 text-xs">
          <span className="text-indigo-400">{run.injected_count} injected</span>
          {run.excluded_count > 0 && (
            <span className="text-[var(--muted)]">{run.excluded_count} excluded</span>
          )}
          {annotations.length > 0 && (
            <span className="text-amber-400">{annotations.length} annotation{annotations.length > 1 ? "s" : ""}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-3 space-y-4">
          {/* Existing annotations */}
          {annotations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {annotations.map((a) => {
                const cfg = ANNOTATION_CONFIG.find((c) => c.type === a.annotation_type);
                return (
                  <span
                    key={a.annotation_id}
                    className={`rounded border px-2 py-0.5 text-xs ${TONE_CLASS[cfg?.tone ?? "amber"].active}`}
                  >
                    {cfg?.label ?? a.annotation_type}
                  </span>
                );
              })}
            </div>
          )}

          {/* Excluded reasons */}
          {run.excluded.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Excluded</p>
              {run.excluded.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--foreground)] truncate max-w-[60%]">{e.title || e.id}</span>
                  <span className="text-[var(--muted)] font-mono ml-2">{e.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Annotation form — collapsed by default */}
          <div>
            <button
              onClick={() => setShowAnnotate(v => !v)}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {showAnnotate ? "▾ Hide manual annotation" : "▸ Annotate manually"}
            </button>
            {showAnnotate && (
              <div className="mt-2.5 space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {ANNOTATION_CONFIG.map(({ type, label, tone }) => {
                    const alreadyDone = existingTypes.has(type);
                    const isSelected = selected.has(type);
                    return (
                      <button
                        key={type}
                        onClick={() => !alreadyDone && toggle(type)}
                        disabled={alreadyDone}
                        className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                          alreadyDone
                            ? `${TONE_CLASS[tone].active} opacity-50 cursor-default`
                            : isSelected
                              ? TONE_CLASS[tone].active
                              : TONE_CLASS[tone].idle
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {selected.size > 0 && (
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Optional note…"
                    className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-indigo-700 resize-none"
                  />
                )}
                <button
                  onClick={submit}
                  disabled={saving || selected.size === 0}
                  className="rounded bg-indigo-700 px-3 py-1.5 text-xs text-white hover:bg-indigo-600 disabled:opacity-40"
                >
                  {saving ? "Saving…" : `Save${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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

const LOOKBACK_OPTIONS = [
  { label: "4 h", hours: 4 },
  { label: "24 h", hours: 24 },
  { label: "48 h", hours: 48 },
  { label: "7 d", hours: 168 },
];

function HarvestPanel({ onHarvested }: { onHarvested: () => void }) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<HarvestMeta | null>(null);
  const [hours, setHours] = useState(48);
  const [customHours, setCustomHours] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ submitted: number; annotations: number; output: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoInterval, setAutoInterval] = useState<number | null>(null);
  const [nextRunIn, setNextRunIn] = useState<string | null>(null);

  async function fetchMeta() {
    const d = await fetch("/api/harvest").then((r) => r.json());
    const m: HarvestMeta = d.meta ?? { running: false };
    setMeta(m);
    return m;
  }

  // On mount: load meta and restore running state if server says so
  useEffect(() => {
    fetchMeta().then((m) => {
      if (m.running) setRunning(true);
    });
  }, []);

  // Poll while running (covers page-navigate-away-and-back case)
  useEffect(() => {
    if (!running) return;
    const poll = setInterval(async () => {
      const m = await fetchMeta();
      if (!m.running) {
        setRunning(false);
        clearInterval(poll);
        if (m.last_output_tail) {
          setResult({
            submitted: m.last_submitted ?? 0,
            annotations: m.last_annotations ?? 0,
            output: m.last_output_tail,
          });
        }
        onHarvested();
      }
    }, 3_000);
    return () => clearInterval(poll);
  }, [running]);

  // Auto-harvest ticker
  useEffect(() => {
    if (autoInterval === null) { setNextRunIn(null); return; }
    const intervalMs = autoInterval * 60 * 60 * 1000;
    let remaining = intervalMs;
    const tick = setInterval(() => {
      remaining -= 10_000;
      if (remaining <= 0) {
        remaining = intervalMs;
        runHarvest();
      }
      const h = Math.floor(remaining / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      setNextRunIn(`${h}h ${m}m`);
    }, 10_000);
    setNextRunIn(`${autoInterval}h 0m`);
    return () => clearInterval(tick);
  }, [autoInterval]);

  async function runHarvest() {
    setRunning(true);
    setResult(null);
    setError(null);
    const effectiveHours = customHours.trim() ? parseInt(customHours, 10) : hours;
    const res = await fetch("/api/harvest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: effectiveHours }),
    });
    const data = await res.json();
    setRunning(false);
    if (res.ok && data.ok) {
      setResult({ submitted: data.submitted, annotations: data.annotations, output: data.output ?? [] });
      await fetchMeta();
      onHarvested();
    } else {
      setError(data.error ?? "Harvest failed");
    }
  }

  const effectiveHours = customHours.trim() ? parseInt(customHours, 10) : hours;

  return (
    <div className="rounded-lg border border-indigo-800/40 bg-[var(--surface)]">
      <button
        onClick={() => { setOpen((v) => !v); setResult(null); setError(null); }}
        className="w-full text-left px-4 py-3 flex items-center gap-2"
      >
        <span className="text-sm font-medium">Harvest sessions</span>
        <span className="text-xs text-[var(--muted)]">— extract candidate decisions from Claude Code session files</span>
        {meta && (
          <span className="text-xs text-[var(--muted)]">
            · last run {timeAgo(meta.last_run_ts)} · {meta.last_submitted} submitted
          </span>
        )}
        {autoInterval && nextRunIn && (
          <span className="text-xs text-indigo-400 ml-1">· auto in {nextRunIn}</span>
        )}
        <span className="ml-auto text-xs text-[var(--muted)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3 space-y-3">
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Reads your Claude Code session files, extracts candidate decisions using Claude, and submits them as proposals for review.
            Also posts run annotations (corrections, decisions followed/ignored) automatically.
          </p>

          {/* Lookback selector */}
          <div className="space-y-1">
            <p className="text-xs text-[var(--muted)]">Lookback window</p>
            <div className="flex gap-1.5 flex-wrap">
              {LOOKBACK_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => { setHours(opt.hours); setCustomHours(""); }}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    hours === opt.hours && !customHours.trim()
                      ? "border-indigo-600 bg-indigo-950/40 text-indigo-300"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <input
                type="number"
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                placeholder="custom h"
                className="w-20 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-indigo-700"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={runHarvest}
              disabled={running}
              className="rounded bg-indigo-700 px-3 py-1.5 text-xs text-white hover:bg-indigo-600 disabled:opacity-40"
            >
              {running ? "Harvesting…" : `Harvest last ${effectiveHours}h`}
            </button>

            {/* Auto-harvest toggle */}
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span>Auto every</span>
              {([4, 8, 24] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setAutoInterval(autoInterval === h ? null : h)}
                  className={`rounded border px-2 py-0.5 transition-colors ${
                    autoInterval === h
                      ? "border-indigo-600 bg-indigo-950/40 text-indigo-300"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {h}h
                </button>
              ))}
              {autoInterval && <span className="text-indigo-400">· active (tab must stay open)</span>}
            </div>
          </div>

          {/* Output */}
          {result && (
            <div className="space-y-1">
              <p className="text-xs text-green-400">
                Done · {result.submitted} proposal{result.submitted !== 1 ? "s" : ""} submitted · {result.annotations} annotation{result.annotations !== 1 ? "s" : ""} posted
              </p>
              {result.output.length > 0 && (
                <pre className="rounded bg-[var(--panel-2)] border border-[var(--border)] p-2 text-xs text-[var(--muted)] leading-relaxed overflow-x-auto max-h-40">{result.output.join("\n")}</pre>
              )}
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

function RecordSessionPanel({ activeProject, onLogged }: { activeProject: string | null; onLogged: () => void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"file" | "manual">("file");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ injected_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setResult(null);
    setError(null);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: activeProject ?? undefined, source, note: note.trim() || undefined }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setResult(data);
      setNote("");
      onLogged();
    } else {
      setError(data.error ?? "Unknown error");
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        onClick={() => { setOpen((v) => !v); setResult(null); setError(null); }}
        className="w-full text-left px-4 py-3 flex items-center gap-2"
      >
        <span className="text-sm font-medium">Record a past session</span>
        <span className="text-xs text-[var(--muted)]">— add a run record for a session that wasn't captured automatically</span>
        <span className="ml-auto text-xs text-[var(--muted)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3 space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Creates a run record using the currently active decisions{activeProject ? ` for project "${activeProject}"` : ""}.
            Use this when you completed a session with <code className="font-mono bg-[var(--panel-2)] px-1 rounded">GOVERNED_CONTINUITY.md</code> active
            but the run wasn't captured automatically — for example, before run-logging was set up.
            This does not extract decisions; it only records what was active at the time.
          </p>
          <div className="flex gap-3 text-xs">
            {(["file", "manual"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  value={s}
                  checked={source === s}
                  onChange={() => setSource(s)}
                  className="accent-indigo-500"
                />
                <span className="text-[var(--foreground)]">{s === "file" ? "File injection (GOVERNED_CONTINUITY.md)" : "Manual / other"}</span>
              </label>
            ))}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. 'auth refactor session')"
            className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-indigo-700"
          />
          <button
            onClick={submit}
            disabled={saving}
            className="rounded bg-indigo-700 px-3 py-1.5 text-xs text-white hover:bg-indigo-600 disabled:opacity-40"
          >
            {saving ? "Logging…" : "Log session"}
          </button>
          {result && (
            <p className="text-xs text-green-400">
              Session logged · {result.injected_count} decision{result.injected_count !== 1 ? "s" : ""} recorded
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<ContinuityRunRecord[]>([]);
  const [annotations, setAnnotations] = useState<Record<string, RunAnnotation[]>>({});
  const [stats, setStats] = useState<{ total_runs: number; total_injected: number; total_excluded: number; exclusion_reasons: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const proj = activeProject ? `&project=${activeProject}` : "";
    const [runsData, annotsData] = await Promise.all([
      fetch(`/api/runs?limit=50${proj}`).then((r) => r.json()),
      fetch(`/api/run-annotations?limit=500`).then((r) => r.json()),
    ]);

    const fetchedRuns: ContinuityRunRecord[] = runsData.runs ?? [];
    setRuns(fetchedRuns);
    setStats(runsData.stats ?? null);

    // Group annotations by run_id
    const grouped: Record<string, RunAnnotation[]> = {};
    for (const a of (annotsData.annotations ?? []) as RunAnnotation[]) {
      if (!grouped[a.run_id]) grouped[a.run_id] = [];
      grouped[a.run_id].push(a);
    }
    setAnnotations(grouped);
    setLoading(false);
  }

  useEffect(() => { load(); }, [activeProject]);

  function handleAnnotated(runId: string, newAnnotations: RunAnnotation[]) {
    setAnnotations((prev) => ({
      ...prev,
      [runId]: [...(prev[runId] ?? []), ...newAnnotations],
    }));
  }

  const annotatedRunCount = Object.values(annotations).filter((a) => a.length > 0).length;

  if (loading) return <div className="text-[var(--muted)] text-sm">Loading…</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runs"
        description={`${stats?.total_runs ?? 0} continuity runs logged · ${annotatedRunCount} annotated — annotate runs to make continuity outcomes measurable.`}
      />

      <ProjectBar activeProject={activeProject} onSelect={setActiveProject} />

      <HarvestPanel onHarvested={load} />

      <RecordSessionPanel activeProject={activeProject} onLogged={load} />

      {/* Stats strip */}
      {stats && stats.total_runs > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-xs text-[var(--muted)]">Total injections</p>
            <p className="text-lg font-semibold">{stats.total_injected}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-xs text-[var(--muted)]">Total exclusions</p>
            <p className="text-lg font-semibold">{stats.total_excluded}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-xs text-[var(--muted)]">Annotated</p>
            <p className="text-lg font-semibold">{annotatedRunCount}</p>
          </div>
        </div>
      )}

      {/* Exclusion reason breakdown */}
      {stats && Object.keys(stats.exclusion_reasons).length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)] mb-2">Exclusion reasons</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.exclusion_reasons).map(([reason, count]) => (
              <div key={reason} className="text-xs">
                <span className="font-mono text-[var(--muted)]">{reason}</span>
                <span className="ml-1.5 font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run list */}
      {runs.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--muted)]">No runs logged yet.</p>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Runs are created automatically when an agent calls <code className="font-mono bg-[var(--panel-2)] px-1 rounded">GET /api/memory</code> to pull active decisions into context,
            or when you generate a <code className="font-mono bg-[var(--panel-2)] px-1 rounded">GOVERNED_CONTINUITY.md</code> file from the Decisions page.
            You can also log a past session manually using the panel above.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunCard
              key={run.run_id}
              run={run}
              annotations={annotations[run.run_id] ?? []}
              onAnnotated={handleAnnotated}
            />
          ))}
        </div>
      )}
    </div>
  );
}
