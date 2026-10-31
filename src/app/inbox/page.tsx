"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Email = {
  id: string; from_name: string; from_email: string; subject: string; body: string; received_at: string;
  category: string | null; urgency: string | null; needs_human: boolean | null; summary: string | null;
  flagged: boolean; flag_reasons: string[]; processed_at: string | null;
};

const CATS: { key: string; label: string }[] = [
  { key: "interview", label: "Interviews" },
  { key: "candidate_question", label: "Candidate questions and complaints" },
  { key: "internal", label: "Internal" },
  { key: "application", label: "New applications" },
  { key: "vendor", label: "Vendors" },
  { key: "spam_phishing", label: "Spam and phishing" },
  { key: "other", label: "Other" },
];
const URG: Record<string, string> = { high: "bg-block-soft text-block", medium: "bg-ai-soft text-ai", low: "bg-wash text-ink-3" };
const URG_LABEL: Record<string, string> = { high: "Urgent", medium: "This week", low: "Low" };
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
    setMsg(r.ok ? `Digest ready: ${j.classified} emails sorted, ${j.blocked} blocked.` : j.error);
    setBusy(false); load();
  }

  const done = emails.filter((e) => e.processed_at);
  const flagged = done.filter((e) => e.flagged);
  const needs = done.filter((e) => !e.flagged && e.needs_human);
  const high = done.filter((e) => !e.flagged && e.urgency === "high");

  const Row = ({ e }: { e: Email }) => (
    <div className="px-5 py-3">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-left text-sm" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
        {e.urgency && <span className={`chip ${URG[e.urgency]}`}>{URG_LABEL[e.urgency]}</span>}
        {e.needs_human && !e.flagged && <span className="chip bg-ai-soft text-ai ring-1 ring-ai/20">Needs your answer</span>}
        <b className="min-w-0 flex-1 truncate font-medium text-ink">{e.subject}</b>
        <span className="whitespace-nowrap text-xs text-ink-3">{e.from_name}, {ago(e.received_at)}</span>
      </button>
      {e.summary && <p className="mt-1 max-w-[80ch] text-sm text-ink-2">{e.summary}</p>}
      {open === e.id && <pre className="doc mt-2 rounded-md bg-paper p-3 text-ink-2">{e.from_email}{"\n\n"}{e.body}</pre>}
    </div>
  );

  const stats = [
    { n: emails.length, label: "emails in the inbox" },
    { n: high.length, label: "urgent today", tone: "text-block" },
    { n: needs.length, label: "need a human answer", tone: "text-ai" },
    { n: flagged.length, label: "blocked for manipulation", tone: "text-block" },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">Inbox digest</h1>
          <p className="page-lede">The AI sorts the HR inbox by type and urgency and points out what needs a person. It never replies by itself. Every email is scanned for manipulation before the AI reads it.</p>
        </div>
        <button onClick={digest} disabled={busy} className="btn btn-primary">
          {busy ? "Sorting…" : done.length ? "Refresh digest" : "Sort today's inbox"}
        </button>
        {msg && (
          <p role="status" className="flex w-full items-center gap-2 rounded-md bg-white px-3 py-2 text-sm text-ink-2 ring-1 ring-line">
            {busy && <span className="h-2 w-2 animate-pulse rounded-full bg-ai" />}{msg}
          </p>
        )}
      </header>

      {!emails.length && <p className="panel px-5 py-10 text-center text-sm text-ink-2">The inbox is empty. Run supabase/migration_03_inbox.sql to load the demo inbox.</p>}

      {done.length > 0 && (
        <dl className="grid grid-cols-2 overflow-hidden rounded-[10px] border bg-white md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className={`px-4 py-3.5 ${i ? "md:border-l" : ""} ${i % 2 ? "max-md:border-l" : ""} ${i > 1 ? "max-md:border-t" : ""}`}>
              <dd className={`text-2xl font-semibold tabular-nums ${s.tone ?? "text-ink"}`}>{s.n}</dd>
              <dt className="mt-0.5 text-xs text-ink-2">{s.label}</dt>
            </div>
          ))}
        </dl>
      )}

      {flagged.length > 0 && (
        <section className="overflow-hidden rounded-[10px] border border-block/30 bg-white">
          <div className="border-b border-block/20 bg-block-soft px-5 py-3.5">
            <h2 className="section-title text-block">Blocked: emails that give instructions to the AI</h2>
            <p className="mt-0.5 text-sm text-block/80">Kept out of the AI summary. Read them yourself.</p>
          </div>
          <div className="divide-y">
            {flagged.map((e) => (
              <div key={e.id}>
                <Row e={e} />
                <div className="flex flex-wrap gap-1.5 px-5 pb-3">{e.flag_reasons.map((r, i) => <span key={i} className="chip bg-block-soft font-normal text-block">{r}</span>)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && CATS.map((c) => {
        const list = done.filter((e) => !e.flagged && e.category === c.key).sort((a, b) => ORDER[a.urgency ?? "low"] - ORDER[b.urgency ?? "low"]);
        if (!list.length) return null;
        return (
          <section key={c.key} className="panel overflow-hidden">
            <h2 className="section-title border-b px-5 py-3">{c.label} <span className="font-normal text-ink-3">{list.length}</span></h2>
            <div className="divide-y">{list.map((e) => <Row key={e.id} e={e} />)}</div>
          </section>
        );
      })}

      {!done.length && emails.length > 0 && (
        <section className="panel overflow-hidden">
          <h2 className="section-title border-b px-5 py-3">Unsorted inbox <span className="font-normal text-ink-3">{emails.length}</span></h2>
          <div className="divide-y">{emails.map((e) => <Row key={e.id} e={e} />)}</div>
        </section>
      )}
    </div>
  );
}
