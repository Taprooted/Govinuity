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

const LOOKBACK_OPTIONS = [
  { label: "4 h", hours: 4 },
  { label: "24 h", hours: 24 },
  { label: "48 h", hours: 48 },
  { label: "7 d", hours: 168 },
];

export default function HarvestPage() {
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

  useEffect(() => {
    fetchMeta().then((m) => {
      if (m.running) setRunning(true);
    });
  }, []);

  // Poll while running — survives page navigation
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
      }
    }, 3_000);
    return () => clearInterval(poll);
  }, [running]);

  // Auto-harvest ticker (browser-based, tab must stay open)
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
    } else {
      setError(data.error ?? "Harvest failed");
    }
  }

  const effectiveHours = customHours.trim() ? parseInt(customHours, 10) : hours;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Harvest"
        description="Surface candidate decisions from your Claude Code sessions. Extracted proposals go to Review — nothing becomes active context until you ratify it."
      />

      {/* Main harvest card */}
      <div className="rounded-lg border border-indigo-800/40 bg-[var(--surface)] px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Extract from session files</p>
            <p className="mt-0.5 text-xs text-[var(--muted)] leading-relaxed max-w-2xl">
              Reads your Claude Code session files, extracts candidate decisions using Claude, and submits them
              as proposals for review. Also detects correction signals — decisions followed, ignored, or requiring
              context restatement — and posts them as run annotations automatically.
            </p>
          </div>
          {meta?.last_run_ts && !running && (
            <div className="text-right shrink-0">
              <p className="text-xs text-[var(--muted)]">Last run</p>
              <p className="text-xs font-medium">{timeAgo(meta.last_run_ts)}</p>
              {meta.last_submitted !== undefined && (
                <p className="text-xs text-[var(--muted)]">{meta.last_submitted} submitted · {meta.last_annotations ?? 0} annotations</p>
              )}
            </div>
          )}
          {running && (
            <p className="text-xs text-indigo-400 animate-pulse shrink-0">Harvesting…</p>
          )}
        </div>

        {/* Lookback + trigger */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--muted)]">Lookback</span>
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
          <button
            onClick={runHarvest}
            disabled={running}
            className="rounded bg-indigo-700 px-3 py-1.5 text-xs text-white hover:bg-indigo-600 disabled:opacity-40"
          >
            {running ? "Harvesting…" : `Harvest last ${effectiveHours}h`}
          </button>
        </div>

        {/* Auto-harvest */}
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span>Auto-harvest every</span>
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
          {autoInterval && nextRunIn
            ? <span className="text-indigo-400">· next in {nextRunIn} (tab must stay open)</span>
            : <span>— tab must stay open</span>
          }
        </div>

        {/* Output */}
        {result && (
          <div className="space-y-1.5 pt-1 border-t border-[var(--border)]">
            <p className="text-xs text-green-400">
              Done · {result.submitted} proposal{result.submitted !== 1 ? "s" : ""} submitted to{" "}
              <Link href="/review" className="underline hover:text-green-300">Review</Link>
              {" "}· {result.annotations} annotation{result.annotations !== 1 ? "s" : ""} posted
            </p>
            {result.output.length > 0 && (
              <pre className="rounded bg-[var(--panel-2)] border border-[var(--border)] p-2 text-xs text-[var(--muted)] leading-relaxed overflow-x-auto max-h-48">{result.output.join("\n")}</pre>
            )}
          </div>
        )}
        {error && <p className="text-xs text-red-400 pt-1 border-t border-[var(--border)]">{error}</p>}
      </div>

      {/* Other agent tools */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 space-y-2">
        <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Other agent tools</p>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          The harvest script accepts any session file or stdin — not just Claude Code. Use <code className="font-mono bg-[var(--panel-2)] px-1 rounded">--input</code> to process output from Cursor, LangGraph, OpenAI Assistants, or any tool that exports conversation text.
        </p>
        <pre className="rounded bg-[var(--panel-2)] border border-[var(--border)] p-3 text-xs text-[var(--foreground)] leading-relaxed overflow-x-auto">{`# From a file
python3 scripts/harvest_proposals.py --input session.txt --source cursor --submit

# From stdin
cat session.txt | python3 scripts/harvest_proposals.py --input - --source langgraph --submit`}</pre>
      </div>

      {/* Manual proposal */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 space-y-2">
        <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Submit a proposal manually</p>
        <pre className="rounded bg-[var(--panel-2)] border border-[var(--border)] p-3 text-xs text-[var(--foreground)] leading-relaxed overflow-x-auto">{`curl -X POST http://localhost:3000/api/decisions \\
  -H "Content-Type: application/json" \\
  -d '{
    "body": "All database migrations must be reviewed before running in production.",
    "status": "proposed",
    "proposal_class": "durable_constraint",
    "summary_for_human": "Prevents unreviewed migrations from reaching production.",
    "rationale": "A bad migration is hard to reverse and can cause data loss."
  }'`}</pre>
      </div>
    </div>
  );
}
