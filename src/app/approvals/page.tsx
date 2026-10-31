"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Draft = {
  id: string; kind: string; subject: string; body: string; status: string; created_at: string; decided_at: string | null;
  candidates: { code: string; full_name: string | null; email: string | null };
};
const KIND: Record<string, string> = { invite: "📅 Interview invite", rejection: "✉️ Rejection", request_info: "❓ Request info" };

export default function Approvals() {
  const sb = supabaseBrowser();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.from("drafts").select("*, candidates(code, full_name, email)").order("created_at", { ascending: false });
    setDrafts(data ?? []);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function decide(d: Draft, action: "approve" | "discard") {
    setBusy(d.id);
    const e = edits[d.id];
    await fetch(`/api/drafts/${d.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(e ?? {}) }),
    });
    setBusy(""); load();
  }

  const pending = drafts.filter((d) => d.status === "pending");
  const sent = drafts.filter((d) => d.status === "sent");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Approval queue</h1>
        <p className="text-sm text-slate-500">AI drafts every reply from the candidate&apos;s own file only. Nothing is sent until a human approves.</p>
      </div>
      {!pending.length && <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">No drafts waiting. ✅</p>}
      {pending.map((d) => {
        const e = edits[d.id] ?? { subject: d.subject, body: d.body };
        return (
          <div key={d.id} className="space-y-2 rounded-xl border bg-white p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">{KIND[d.kind]}</span>
              <b>{d.candidates.code}</b>
              <span className="text-slate-500">→ {d.candidates.full_name} &lt;{d.candidates.email}&gt;</span>
            </div>
            <input className="w-full rounded border px-3 py-2 text-sm font-medium" value={e.subject}
              onChange={(ev) => setEdits({ ...edits, [d.id]: { ...e, subject: ev.target.value } })} />
            <textarea className="h-40 w-full rounded border px-3 py-2 text-sm" value={e.body}
              onChange={(ev) => setEdits({ ...edits, [d.id]: { ...e, body: ev.target.value } })} />
            <div className="flex gap-2">
              <button onClick={() => decide(d, "approve")} disabled={!!busy} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white">Approve & send</button>
              <button onClick={() => decide(d, "discard")} disabled={!!busy} className="rounded border px-3 py-1.5 text-sm">Discard</button>
              {edits[d.id] && <span className="self-center text-xs text-amber-600">edited by you</span>}
            </div>
          </div>
        );
      })}
      {sent.length > 0 && (
        <section className="rounded-xl border bg-white">
          <h2 className="border-b p-4 font-semibold">Outbox (sent after human approval)</h2>
          {sent.map((d) => (
            <details key={d.id} className="border-b p-4 text-sm last:border-0">
              <summary className="cursor-pointer"><b>{d.candidates.code}</b> · {d.subject} <span className="text-xs text-slate-400">{d.decided_at && new Date(d.decided_at).toLocaleString()}</span></summary>
              <pre className="mt-2 whitespace-pre-wrap text-slate-600">{d.body}</pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
