"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Draft = {
  id: string; kind: string; subject: string; body: string; status: string; created_at: string; decided_at: string | null;
  candidates: { code: string; full_name: string | null; email: string | null };
};
const KIND: Record<string, string> = { invite: "Interview invite", rejection: "Rejection", request_info: "Request for information" };

export default function Approvals() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await sb.from("drafts").select("*, candidates(code, full_name, email)").order("created_at", { ascending: false });
    setDrafts(data ?? []);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function decide(d: Draft, action: "approve" | "discard") {
    setBusy(d.id);
    const e = edits[d.id];
    const r = await fetch(`/api/drafts/${d.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(e ?? {}) }),
    });
    const j = await r.json().catch(() => ({}));
    setErrors({ ...errors, [d.id]: r.ok ? "" : j.error ?? "Error" });
    setBusy(""); load(); router.refresh();
  }

  const pending = drafts.filter((d) => d.status === "pending");
  const sent = drafts.filter((d) => d.status === "sent");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="page-title">Approval queue</h1>
        <p className="page-lede">The AI writes each reply from that candidate&apos;s file only. It has no way to send. A message leaves only when you approve it here.</p>
      </header>

      {!pending.length && (
        <div className="panel px-5 py-10 text-center">
          <p className="font-medium">Nothing waiting for you.</p>
          <p className="mt-1 text-sm text-ink-2">Shortlist, reject or ask for info on the Candidates page and the AI drafts the reply here.</p>
        </div>
      )}

      {pending.map((d) => {
        const e = edits[d.id] ?? { subject: d.subject, body: d.body };
        return (
          <article key={d.id} className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-ai-soft/60 px-5 py-3 text-sm">
              <span className="chip bg-ai-soft text-ai ring-1 ring-ai/20">AI draft, not sent</span>
              <span className="font-medium">{KIND[d.kind]}</span>
              <span className="text-ink-2">to <b className="font-medium text-ink">{d.candidates.full_name}</b> ({d.candidates.code})</span>
              <span className="ml-auto text-xs text-ink-3">{d.candidates.email}</span>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-3">Subject</span>
                <input className="field font-medium" value={e.subject}
                  onChange={(ev) => setEdits({ ...edits, [d.id]: { ...e, subject: ev.target.value } })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-3">Message. The candidate&apos;s name replaces {"{{candidate_name}}"} when you approve; the AI never saw it.</span>
                <textarea className="field h-48 resize-y leading-relaxed" value={e.body}
                  onChange={(ev) => setEdits({ ...edits, [d.id]: { ...e, body: ev.target.value } })} />
              </label>
              {errors[d.id] && <p role="alert" className="rounded-md bg-block-soft px-3 py-2 text-sm text-block">Not sent: {errors[d.id]}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t bg-paper/60 px-5 py-3">
              <button onClick={() => decide(d, "approve")} disabled={!!busy} className="btn btn-approve">Approve and send</button>
              <button onClick={() => decide(d, "discard")} disabled={!!busy} className="btn btn-ghost">Discard</button>
              {edits[d.id] && <span className="text-xs text-ai">You edited this draft</span>}
            </div>
          </article>
        );
      })}

      {sent.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="border-b px-5 py-3.5">
            <h2 className="section-title">Sent</h2>
            <p className="text-xs text-ink-3">Each one approved by a person. Sending is simulated for the demo.</p>
          </div>
          <div className="divide-y">
            {sent.map((d) => (
              <details key={d.id} className="group px-5 py-3 text-sm">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="chip bg-human-soft text-human">Approved</span>
                  <b className="font-medium">{d.candidates.code}</b>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{d.subject}</span>
                  <span className="text-xs text-ink-3">{d.decided_at && new Date(d.decided_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap rounded-md bg-paper p-3 font-sans text-sm leading-relaxed text-ink-2">{d.body}</pre>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
