"use client";
import { useState } from "react";

type Res = { groups: { label: string; scores: number[] }[]; spread: number | null; errors: string[] };

export default function ConsistencyRunner() {
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true); setErr("");
    const r = await fetch("/api/security/consistency", { method: "POST" });
    const j = await r.json();
    if (!r.ok) setErr(j.error); else setRes(j);
    setBusy(false);
  }

  const ok = res && res.spread !== null && res.spread <= 5;
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title">Consistency test</h2>
        {res && res.spread !== null && <span className={`chip ${ok ? "bg-human-soft text-human" : "bg-block-soft text-block"}`}>Largest gap: {res.spread} points</span>}
        <button onClick={run} disabled={busy} className="btn btn-primary ml-auto">{busy ? "Scoring 8 times, about 45 s…" : "Score 2 resumes 4 times each"}</button>
      </div>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">A fair screening tool gives the same resume the same score every time. A public test of another open-source hiring agent scored one resume anywhere from 66 to 99.</p>
      {err && <p role="alert" className="mt-3 rounded-md bg-block-soft px-3 py-2 text-sm text-block">{err}</p>}
      {res && (
        <div className="mt-4 flex flex-wrap gap-10">
          {res.groups.map((g) => (
            <div key={g.label}>
              <div className="mb-2 text-xs font-semibold">{g.label}</div>
              <div className="flex h-[120px] items-end gap-2 border-b">
                {g.scores.map((s, i) => (
                  <div key={i} className="flex w-10 flex-col items-center justify-end gap-1">
                    <span className="text-xs font-medium tabular-nums">{s}</span>
                    <div className="w-full rounded-t-sm bg-ink/75" style={{ height: `${s}px` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-2 text-[11px] text-ink-3">{g.scores.map((_, i) => <span key={i} className="w-10 text-center">run {i + 1}</span>)}</div>
            </div>
          ))}
          {res.errors.length > 0 && <p className="text-xs text-block">{res.errors.length} run(s) failed: {res.errors[0]}</p>}
        </div>
      )}
    </section>
  );
}
