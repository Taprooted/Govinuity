"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../components/ui";
import { timeAgo } from "../../lib/utils";

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

type SourceMode = "paste" | "scan";
type SourcePreset = "current" | "parent" | "all" | "custom";

type SourceOption = {
  id: SourcePreset;
  label: string;
  description: string;
  sessionDir: string;
  recommended?: boolean;
  warning?: string;
};

type Preflight = {
  exists: boolean;
  resolved: string;
  totalFiles: number;
  usableFiles: number;
  harvestGeneratedFiles: number;
  newestUsableFile: string | null;
  newestUsableAt: string | null;
  warnings: string[];
};

const LOOKBACK_OPTIONS = [
  { label: "4 h", hours: 4 },
  { label: "24 h", hours: 24 },
  { label: "48 h", hours: 48 },
  { label: "7 d", hours: 168 },
];

const SOURCE_LABELS = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "openai", label: "OpenAI" },
  { value: "langgraph", label: "LangGraph" },
  { value: "custom", label: "Other" },
];

function sourceHint(source: string) {
  if (source === "codex") return "Paste the relevant Codex exchange or a short session summary.";
  if (source === "claude-code") return "Paste text here, or use local scanning if you want Govinuity to read Claude Code session files.";
  if (source === "cursor") return "Paste a Cursor chat or exported conversation.";
  if (source === "chatgpt") return "Paste a ChatGPT conversation, export, or project chat summary.";
  if (source === "openai") return "Paste an OpenAI-style messages array or a readable transcript.";
  if (source === "langgraph") return "Paste a run transcript, trace summary, or messages JSON.";
  return "Paste readable turns, raw notes, or exported messages from your agent workflow.";
}

function formatCount(n: number, label: string) {
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}

function sourcePresetLabel(options: SourceOption[], preset: SourcePreset) {
  return options.find((option) => option.id === preset)?.label ?? "Selected source";
}

export default function HarvestPage() {
  const [meta, setMeta] = useState<HarvestMeta | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("paste");

  const [pastedText, setPastedText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("codex");
  const [customSource, setCustomSource] = useState("");
  const [importFileName, setImportFileName] = useState("");

  const [hours, setHours] = useState(48);
  const [customHours, setCustomHours] = useState("");
  const [sourcePreset, setSourcePreset] = useState<SourcePreset>("current");
  const [sessionDir, setSessionDir] = useState("");
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [ignoreWatermark, setIgnoreWatermark] = useState(false);
  const [maxFiles, setMaxFiles] = useState(25);
  const [autoInterval, setAutoInterval] = useState<number | null>(null);
  const [nextRunIn, setNextRunIn] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ submitted: number; annotations: number; output: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveHours = customHours.trim() ? parseInt(customHours, 10) : hours;
  const effectiveSource = sourceLabel === "custom" ? customSource.trim() || "custom" : sourceLabel;
  const canSubmit = sourceMode === "paste" ? pastedText.trim().length > 0 && !running : !running && preflight?.usableFiles !== 0;

  async function fetchMeta() {
    const d = await fetch("/api/harvest").then((r) => r.json());
    const m: HarvestMeta = d.meta ?? { running: false };
    setMeta(m);
    if (d.sources) setSourceOptions(d.sources);
    return m;
  }

  async function fetchPreflight() {
    setPreflightLoading(true);
    try {
      const params = new URLSearchParams({ preflight: "true", sourcePreset });
      if (sourcePreset === "custom" && sessionDir.trim()) params.set("sessionDir", sessionDir.trim());
      const d = await fetch(`/api/harvest?${params.toString()}`).then((r) => r.json());
      setPreflight(d.preflight ?? null);
      if (d.sources) setSourceOptions(d.sources);
    } finally {
      setPreflightLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/harvest").then((r) => r.json()).then((d) => {
      const m: HarvestMeta = d.meta ?? { running: false };
      setMeta(m);
      if (m.running) setRunning(true);
      if (d.sources) setSourceOptions(d.sources);
    });
  }, []);

  useEffect(() => {
    if (sourceMode !== "scan") return;
    fetchPreflight();
  }, [sourceMode, sourcePreset, sessionDir]);

  useEffect(() => {
    if (!running || sourceMode === "paste") return;
    const poll = setInterval(async () => {
      const m = await fetchMeta();
      if (!m.running) {
        setRunning(false);
        clearInterval(poll);
        if (m.last_output_tail) {
          setResult({ submitted: m.last_submitted ?? 0, annotations: m.last_annotations ?? 0, output: m.last_output_tail });
        }
      }
    }, 3_000);
    return () => clearInterval(poll);
  }, [running, sourceMode]);

  useEffect(() => {
    if (sourceMode !== "scan" || autoInterval === null) {
      setNextRunIn(null);
      return;
    }

    const intervalMs = autoInterval * 60 * 60 * 1000;
    let remaining = intervalMs;

    const formatRemaining = () => {
      const h = Math.floor(remaining / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      return `${h}h ${m}m`;
    };

    setNextRunIn(formatRemaining());

    const timer = setInterval(() => {
      remaining -= 10_000;
      if (remaining <= 0) {
        remaining = intervalMs;
        if (!running) void runHarvest();
      }
      setNextRunIn(formatRemaining());
    }, 10_000);

    return () => clearInterval(timer);
  }, [autoInterval, sourceMode, running, effectiveHours, sourcePreset, sessionDir, ignoreWatermark, maxFiles]);

  async function runHarvest() {
    setRunning(true);
    setResult(null);
    setError(null);

    const payload = sourceMode === "paste"
      ? { mode: "text", text: pastedText, source: effectiveSource }
      : {
          mode: "sessions",
          hours: effectiveHours,
          sourcePreset,
          sessionDir: sourcePreset === "custom" ? sessionDir.trim() || undefined : undefined,
          ignoreWatermark,
          maxFiles,
        };

    const res = await fetch("/api/harvest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (sourceMode === "paste") setRunning(false);

    if (res.ok && data.ok) {
      setResult({ submitted: data.submitted, annotations: data.annotations, output: data.output ?? [] });
      if (sourceMode === "scan") await fetchMeta();
    } else {
      setRunning(false);
      setError(data.error ?? "Harvest failed");
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setImportFileName(file.name);
    setPastedText(await file.text());
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Harvest"
        description="Turn agent work into reviewable continuity candidates. Ratification still happens in Review."
      />

      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["1", "Add work"],
          ["2", "Surface candidates"],
          ["3", "Review and ratify"],
          ["4", "Reuse continuity"],
        ].map(([step, label]) => (
          <div key={step} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-gold)]">Step {step}</p>
            <p className="mt-1 text-sm text-[var(--foreground)]">{label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--brand-gold)] bg-[var(--surface)] px-5 py-4 space-y-5">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Start here</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">What agent work should Govinuity read?</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              Most users should paste or upload a transcript. Local scanning is useful when your agent stores readable session files on disk.
            </p>
          </div>
          {meta?.last_run_ts && !running && (
            <span className="ml-auto text-xs text-[var(--muted)]">
              Last harvest {timeAgo(meta.last_run_ts)} · {meta.last_submitted ?? 0} proposals · {meta.last_annotations ?? 0} signals
            </span>
          )}
          {running && <span className="ml-auto text-xs text-[var(--brand-gold)] animate-pulse">Harvesting...</span>}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            onClick={() => { setSourceMode("paste"); setResult(null); setError(null); }}
            className={`rounded-lg border p-4 text-left transition-colors ${
              sourceMode === "paste"
                ? "border-[var(--brand-gold)] bg-[var(--brand-gold-soft)]"
                : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--brand-gold)]"
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-green)]">Recommended</p>
            <p className="mt-2 text-base font-semibold text-[var(--foreground)]">Paste or upload a transcript</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Works for Codex, Claude, Cursor, ChatGPT, exported files, and raw notes.</p>
          </button>
          <button
            onClick={() => { setSourceMode("scan"); setResult(null); setError(null); }}
            className={`rounded-lg border p-4 text-left transition-colors ${
              sourceMode === "scan"
                ? "border-[var(--brand-gold)] bg-[var(--brand-gold-soft)]"
                : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--brand-gold)]"
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Local files</p>
            <p className="mt-2 text-base font-semibold text-[var(--foreground)]">Scan session files</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Best for Claude Code-style local JSONL sessions or compatible exports.</p>
          </button>
        </div>

        {sourceMode === "paste" && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--muted)]">Source label</span>
              {SOURCE_LABELS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSourceLabel(s.value)}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    sourceLabel === s.value
                      ? "border-[var(--brand-gold)] bg-[var(--brand-gold-soft)] text-[var(--brand-gold)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
              {sourceLabel === "custom" && (
                <input
                  type="text"
                  value={customSource}
                  onChange={(e) => setCustomSource(e.target.value)}
                  placeholder="source name"
                  className="w-32 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--brand-gold)] focus:outline-none"
                />
              )}
            </div>

            <p className="text-xs text-[var(--muted)]">{sourceHint(sourceLabel)}</p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:border-[var(--brand-gold)]">
                Upload transcript
                <input
                  type="file"
                  accept=".txt,.md,.json,.jsonl,.log"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {importFileName && <p className="text-xs text-[var(--muted)]">Loaded {importFileName}</p>}
            </div>

            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={12}
              placeholder={"Paste an agent conversation, session summary, JSON messages array, or raw notes.\n\nUser: Keep roadmap planning out of the public repo.\nAssistant: Agreed. Future public-repo work should keep roadmap docs private unless explicitly approved."}
              className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] font-mono leading-relaxed focus:border-[var(--brand-gold)] focus:outline-none resize-y"
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={runHarvest}
                disabled={!canSubmit}
                className="rounded bg-[var(--brand-green)] px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                {running ? "Surfacing..." : "Surface proposals"}
              </button>
              <p className="text-xs text-[var(--muted)]">Candidates will appear in <Link href="/review" className="text-[var(--accent)] hover:underline">Review</Link>.</p>
            </div>
          </div>
        )}

        {sourceMode === "scan" && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">Choose scan scope</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Start with the current project. Broader scans can find more, but may include unrelated work.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              {sourceOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSourcePreset(option.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    sourcePreset === option.id
                      ? "border-[var(--brand-gold)] bg-[var(--brand-gold-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand-gold)]"
                  }`}
                >
                  <span className="text-xs font-semibold text-[var(--foreground)]">{option.label}</span>
                  {option.recommended && <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--brand-green)]">Default</span>}
                  <span className="mt-2 block text-xs leading-relaxed text-[var(--muted)]">{option.description}</span>
                  {option.warning && <span className="mt-2 block text-xs text-[var(--brand-coral)]">{option.warning}</span>}
                </button>
              ))}
            </div>

            {sourcePreset === "custom" && (
              <input
                type="text"
                value={sessionDir}
                onChange={(e) => setSessionDir(e.target.value)}
                placeholder="~/path/to/session-exports"
                className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] font-mono focus:border-[var(--brand-gold)] focus:outline-none"
              />
            )}

            <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-[var(--foreground)]">Scan check</p>
                <button
                  onClick={fetchPreflight}
                  className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  {preflightLoading ? "Checking..." : "Refresh"}
                </button>
              </div>
              {preflight ? (
                <div className="space-y-2 text-xs text-[var(--muted)]">
                  <p className="text-[var(--foreground)]">{sourcePresetLabel(sourceOptions, sourcePreset)}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded border border-[var(--border)] px-2 py-1">{formatCount(preflight.totalFiles, "session file")} found</span>
                    <span className="rounded border border-[var(--border)] px-2 py-1">{formatCount(preflight.usableFiles, "usable session")}</span>
                    <span className="rounded border border-[var(--border)] px-2 py-1">{formatCount(preflight.harvestGeneratedFiles, "internal harvest run")} ignored</span>
                  </div>
                  {preflight.newestUsableAt ? (
                    <p>Newest usable session {timeAgo(preflight.newestUsableAt)}</p>
                  ) : (
                    <p>No usable session found. Paste a transcript instead, or choose another scan scope.</p>
                  )}
                  {preflight.warnings.map((warning) => (
                    <p key={warning} className="text-[var(--brand-coral)]">{warning}</p>
                  ))}
                  <details>
                    <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)]">Technical details</summary>
                    <p className="mt-1 font-mono break-all">{preflight.resolved}</p>
                    {preflight.newestUsableFile && <p className="mt-1 font-mono break-all">{preflight.newestUsableFile}</p>}
                  </details>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">Choose a scan scope to check for usable sessions.</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--muted)]">Lookback</span>
              {LOOKBACK_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => { setHours(opt.hours); setCustomHours(""); }}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    hours === opt.hours && !customHours.trim()
                      ? "border-[var(--brand-gold)] bg-[var(--brand-gold-soft)] text-[var(--brand-gold)]"
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
                className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--brand-gold)] focus:outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                Max files
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxFiles}
                  onChange={(e) => setMaxFiles(Math.max(1, Math.min(100, Number(e.target.value) || 25)))}
                  className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)] focus:border-[var(--brand-gold)] focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={ignoreWatermark}
                  onChange={(e) => setIgnoreWatermark(e.target.checked)}
                  className="accent-[var(--brand-gold)]"
                />
                Rescan old turns
              </label>
              <button
                onClick={runHarvest}
                disabled={!canSubmit}
                className="rounded bg-[var(--brand-green)] px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                {running ? "Scanning..." : `Scan last ${effectiveHours}h`}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
              <span className="text-xs font-semibold text-[var(--foreground)]">Optional automation</span>
              <span className="text-xs text-[var(--muted)]">Auto-scan while this tab is open:</span>
              {[4, 8, 24].map((interval) => (
                <button
                  key={interval}
                  onClick={() => setAutoInterval(autoInterval === interval ? null : interval)}
                  className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                    autoInterval === interval
                      ? "border-[var(--brand-gold)] bg-[var(--brand-gold-soft)] text-[var(--brand-gold)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {interval}h
                </button>
              ))}
              {autoInterval === null ? (
                <span className="text-xs text-[var(--muted)]">off</span>
              ) : (
                <span className="text-xs text-[var(--brand-gold)]">next in {nextRunIn ?? `${autoInterval}h 0m`}</span>
              )}
              <details className="text-xs text-[var(--muted)]">
                <summary className="cursor-pointer hover:text-[var(--foreground)]">cron</summary>
                <pre className="mt-2 max-w-full overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--muted)]">0 */4 * * * cd /path/to/govinuity && python3 scripts/harvest_proposals.py --submit &gt;&gt; scripts/harvest.log 2&gt;&amp;1</pre>
              </details>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-1.5 pt-3 border-t border-[var(--border)]">
            {result.submitted > 0 || result.annotations > 0 ? (
              <p className="text-xs text-[var(--brand-green)]">
                Harvest complete · {result.submitted} proposal{result.submitted !== 1 ? "s" : ""} surfaced to{" "}
                <Link href="/review" className="underline hover:opacity-80">Review</Link>
                {" "}· {result.annotations} outcome signal{result.annotations !== 1 ? "s" : ""} logged
              </p>
            ) : (
              <p className="text-xs text-[var(--muted)]">
                Harvest complete · no qualifying proposals were found. Try a denser transcript or a different scan scope.
              </p>
            )}
            {result.output.length > 0 && (
              <pre className="rounded bg-[var(--panel-2)] border border-[var(--border)] p-2 text-xs text-[var(--muted)] leading-relaxed overflow-x-auto max-h-48">{result.output.join("\n")}</pre>
            )}
          </div>
        )}

        {error && (
          <div className="space-y-1 pt-3 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--brand-coral)]">{error}</p>
            <p className="text-xs text-[var(--muted)]">
              Extraction needs either a working Anthropic/Instructor setup or a logged-in Claude CLI fallback. Direct API submission still works.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
