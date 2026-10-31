"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Email = {
  id: string; from_name: string; from_email: string; subject: string; body: string; received_at: string;
  category: string | null; urgency: string | null; needs_human: boolean | null; summary: string | null;
  flagged: boolean; flag_reasons: string[]; processed_at: string | null;
};

const CATS: { key: string; label: string }[] = [
  { key: "interview", label: "📅 Interviews" },
  { key: "candidate_question", label: "❓ Candidate questions & complaints" },
  { key: "internal", label: "🏢 Internal" },
  { key: "application", label: "📄 New applications" },
  { key: "vendor", label: "💼 Vendors" },
  { key: "spam_phishing", label: "⚠️ Spam & phishing" },
  { key: "other", label: "Other" },
];
const URG: Record<string, string> = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-500" };
const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const ago = (iso: string) => { const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000); return h < 1 ? "<1h ago" : `${h}h ago`; };

export default function Inbox() {
  const sb = supabaseBrowser();
  const [emails, setEmails] = useState<Email[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("inbox_emails").select("*").order("received_at", { ascending: false });
    setEmails(data ?? []);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function digest() {
    setBusy(true); setMsg("Scanning emails for manipulation, then AI is sorting the inbox…");
    const r = await fetch("/api/inbox/digest", { method: "POST" });
    const j = await r.json();
    setMsg(r.ok ? `Digest ready: ${j.classified} emails sorted · ${j.blocked} blocked 🚩` : j.error);
    setBusy(false); load();
  }

  const done = emails.filter((e) => e.processed_at);
  const flagged = done.filter((e) => e.flagged);
  const needs = done.filter((e) => !e.flagged && e.needs_human);
  const high = done.filter((e) => !e.flagged && e.urgency === "high");

  const Row = ({ e }: { e: Email }) => (
    <div className="border-b py-2 last:border-0">
      <div className="flex cursor-pointer items-center gap-2 text-sm" onClick={() => setOpen(open === e.id ? null : e.id)}>
        {e.urgency && <span className={`rounded px-1.5 text-xs ${URG[e.urgency]}`}>{e.urgency}</span>}
        {e.needs_human && !e.flagged && <span className="rounded bg-indigo-100 px-1.5 text-xs text-indigo-700">needs human answer</span>}
        <b className="truncate">{e.subject}</b>
        <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{e.from_name} · {ago(e.received_at)}</span>
      </div>
      {e.summary && <p className="text-xs text-slate-600">{e.summary}</p>}
      {open === e.id && <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{e.from_email}{"\n\n"}{e.body}</pre>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Inbox digest</h1>
          <p className="text-sm text-slate-500">The AI sorts the HR inbox by type and urgency and flags what needs a human answer. It never replies on its own. Emails are scanned for manipulation first.</p>
        </div>
        <button onClick={digest} disabled={busy} className="ml-auto rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
          {busy ? "Sorting…" : done.length ? "↻ Refresh digest" : "Generate today's digest"}
        </button>
        {msg && <p className="w-full text-sm text-slate-600">{busy && "⏳ "}{msg}</p>}
      </div>

      {!emails.length && <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">Inbox empty. Run supabase/migration_03_inbox.sql to load the demo inbox.</p>}

      {done.length > 0 && (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-3"><div className="text-2xl font-bold">{emails.length}</div><div className="text-xs">emails</div></div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700"><div className="text-2xl font-bold">{high.length}</div><div className="text-xs">urgent today</div></div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-indigo-700"><div className="text-2xl font-bold">{needs.length}</div><div className="text-xs">need a human answer</div></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800"><div className="text-2xl font-bold">{flagged.length}</div><div className="text-xs">blocked (manipulation)</div></div>
        </div>
      )}

      {flagged.length > 0 && (
        <section className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <h2 className="mb-1 font-semibold text-red-700">🚩 Blocked: emails giving instructions to the AI</h2>
          {flagged.map((e) => (
            <div key={e.id} className="text-sm"><Row e={e} /><p className="text-xs text-red-700">{e.flag_reasons.join(" · ")}</p></div>
          ))}
        </section>
      )}

      {done.length > 0 && CATS.map((c) => {
        const list = done.filter((e) => !e.flagged && e.category === c.key).sort((a, b) => ORDER[a.urgency ?? "low"] - ORDER[b.urgency ?? "low"]);
        if (!list.length) return null;
        return (
          <section key={c.key} className="rounded-xl border bg-white p-4">
            <h2 className="mb-1 font-semibold">{c.label} <span className="text-sm font-normal text-slate-400">({list.length})</span></h2>
            {list.map((e) => <Row key={e.id} e={e} />)}
          </section>
        );
      })}

      {!done.length && emails.length > 0 && (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-1 font-semibold">Unsorted inbox ({emails.length})</h2>
          {emails.map((e) => <Row key={e.id} e={e} />)}
        </section>
      )}
    </div>
  );
}
