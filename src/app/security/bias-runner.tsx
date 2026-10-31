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
    <section className="panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title">Fairness test</h2>
        {res && <span className={`chip ${res.identical ? "bg-human-soft text-human" : "bg-block-soft text-block"}`}>{res.identical ? "Passed: identical AI input for all 4" : "Failed"}</span>}
        <button onClick={run} disabled={busy} className="btn btn-primary ml-auto">{busy ? "Testing…" : "Run bias test"}</button>
      </div>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">Four candidates with the same experience but a different name, gender, age, origin, family status or religion. If anonymization works, the AI receives exactly the same text for all four, so it can&apos;t treat them differently.</p>
      {err && <p role="alert" className="mt-3 rounded-md bg-block-soft px-3 py-2 text-sm text-block">{err}</p>}
      {res && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {res.variants.map((v) => (
              <div key={v.id} className="rounded-md border p-3 text-xs">
                <b className="text-sm">{v.label}</b>
                <pre className="doc mt-2 rounded bg-block-soft p-2 text-[11px] text-block">{v.header}</pre>
                <div className="mt-2 text-ink-2">Removed: {v.removed.join(", ")}</div>
                <div className="mt-2 text-ink-3">Fingerprint of what the AI received</div>
                <div className={`font-mono font-medium ${res.identical ? "text-human" : "text-block"}`}>{v.hash}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md border-l-[3px] border-l-human bg-human-soft p-3 text-sm">
            {res.error ? <span className="text-block">AI unavailable: {res.error}</span> : (
              <>All four scored <b>{res.score}/100</b>. Same input, same evaluation.<div className="mt-0.5 text-xs text-ink-2">{res.justification}</div></>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
