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
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">🎯 Consistency test</h2>
        <button onClick={run} disabled={busy} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {busy ? "Scoring 8 times… (~45 s)" : "▶ Score 2 CVs 4 times each"}
        </button>
        {res && res.spread !== null && <span className={`text-sm font-semibold ${ok ? "text-green-600" : "text-red-600"}`}>Max spread: {res.spread} points</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">A fair screening tool must give the same CV the same score every time. A public test of another open-source hiring agent found the same CV scored anywhere from 66 to 99 (a 33-point spread).</p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {res && (
        <div className="mt-3 flex flex-wrap gap-8">
          {res.groups.map((g) => (
            <div key={g.label}>
              <div className="mb-1 text-xs font-semibold">{g.label}</div>
              <div className="flex items-end gap-2">
                {g.scores.map((s, i) => (
                  <div key={i} className="text-center text-xs">
                    <div className="mx-auto w-10 rounded-t bg-indigo-500" style={{ height: `${s}px` }} />
                    <div className="font-mono">{s}</div><div className="text-slate-400">run {i + 1}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {res.errors.length > 0 && <p className="text-xs text-red-600">{res.errors.length} run(s) failed: {res.errors[0]}</p>}
        </div>
      )}
    </section>
  );
}
