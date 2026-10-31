"use client";
import { useState } from "react";

type V = { id: string; label: string; header: string; removed: string[]; hash: string; preview: string };
type Res = { variants: V[]; identical: boolean; score: number | null; justification: string; error: string };

export default function BiasRunner() {
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true); setErr("");
    const r = await fetch("/api/security/bias", { method: "POST" });
    const j = await r.json();
    if (!r.ok) setErr(j.error); else setRes(j);
    setBusy(false);
  }

  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">⚖️ Fairness test</h2>
        <button onClick={run} disabled={busy} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {busy ? "Testing…" : "▶ Run bias test"}
        </button>
        {res && <span className={`text-sm font-semibold ${res.identical ? "text-green-600" : "text-red-600"}`}>{res.identical ? "PASS: identical AI input for all 4" : "FAIL"}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">4 candidates with the same experience but a different name, gender, age, origin, family status or religion. If anonymization works, the AI receives exactly the same text for all 4, so it cannot treat them differently.</p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {res && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            {res.variants.map((v) => (
              <div key={v.id} className="rounded border p-2 text-xs">
                <b>{v.label}</b>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-red-50 p-1 text-[10px] text-red-800">{v.header}</pre>
                <div className="mt-1 text-slate-500">Removed: {v.removed.join(", ")}</div>
                <div className="mt-1 font-mono">AI input fingerprint:<br /><b className={res.identical ? "text-green-700" : "text-red-700"}>{v.hash}</b></div>
              </div>
            ))}
          </div>
          <div className="rounded border border-green-300 bg-green-50 p-3 text-sm">
            {res.error ? <span className="text-red-600">AI unavailable: {res.error}</span> : (
              <>Score for all 4 candidates: <b>{res.score}/100</b>. Same input, same evaluation.<div className="text-xs text-slate-600">{res.justification}</div></>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
