"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = {
  candidateId: string; code: string; name: string | null; job: string;
  originalKind: string; originalSubject: string; lastContact: string; daysWaiting: number; remindersSent: number;
  state: "due" | "waiting" | "pending_approval" | "max_reached";
};
const KIND: Record<string, string> = { invite: "Interview invite", request_info: "Request for information" };
const STATE: Record<Row["state"], { label: string; cls: string }> = {
  due: { label: "Reminder due", cls: "bg-ai-soft text-ai ring-1 ring-ai/20" },
  pending_approval: { label: "Draft waiting for you", cls: "bg-ai-soft text-ai" },
  waiting: { label: "Too early", cls: "bg-wash text-ink-2" },
  max_reached: { label: "2 reminders sent: call them", cls: "bg-block-soft text-block" },
};
const WAITS = [{ d: 3, label: "3 days" }, { d: 7, label: "7 days" }, { d: 0, label: "Now (demo)" }];

export default function FollowUps() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [wait, setWait] = useState(3);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/followups?days=${wait}`);
    const j = await r.json().catch(() => ({}));
    setLoadErr(r.ok ? "" : j.error ?? "Error");
    setRows(j.rows ?? []);
  }, [wait]);
  useEffect(() => { load(); }, [load]);

  async function act(row: Row, action: "prepare" | "replied") {
    setBusy(row.candidateId);
    const r = await fetch("/api/followups", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: row.candidateId, action, days: wait }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg((m) => ({ ...m, [row.candidateId]: r.ok ? "" : j.error ?? "Error" }));
    setBusy(""); await load(); router.refresh();
  }

  async function prepareAll() {
    for (const row of rows.filter((x) => x.state === "due")) {
      await act(row, "prepare");
      await new Promise((r) => setTimeout(r, 4200)); // AI free tier: ~15 calls/min
    }
  }

  const due = rows.filter((r) => r.state === "due").length;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="page-title">Candidate follow-ups</h1>
        <p className="page-lede">
          Candidates who received an invite or a request for information and have not answered. The list is computed by plain code, not by the AI.
          The AI only drafts the reminder; it goes to the approval queue and leaves only when you approve it. Maximum 2 reminders per candidate.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ink-2">Remind after</span>
        <div className="flex overflow-hidden rounded-md border">
          {WAITS.map((w) => (
            <button key={w.d} onClick={() => setWait(w.d)}
              className={`px-3 py-1.5 ${wait === w.d ? "bg-ink text-white" : "bg-white hover:bg-wash"}`}>{w.label}</button>
          ))}
        </div>
        {due > 0 && (
          <button onClick={prepareAll} disabled={!!busy} className="btn btn-sm btn-primary ml-auto">
            Prepare {due} reminder{due > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {loadErr && <p role="alert" className="rounded-md bg-block-soft px-3 py-2 text-sm text-block">{loadErr}</p>}

      {!rows.length && !loadErr && (
        <div className="panel px-5 py-10 text-center">
          <p className="font-medium">Nobody is waiting for an answer.</p>
          <p className="mt-1 text-sm text-ink-2">Approve an interview invite or a request for information first; candidates who don&apos;t reply show up here.</p>
        </div>
      )}

      {rows.length > 0 && (
        <section className="panel divide-y overflow-hidden">
          {rows.map((r) => (
            <div key={r.candidateId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="font-medium">{r.name ?? r.code}</b>
                  <span className="font-mono text-xs text-ink-3">{r.code}</span>
                  <span className={`chip ${STATE[r.state].cls}`}>{STATE[r.state].label}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-2">
                  {KIND[r.originalKind] ?? r.originalKind} for {r.job} · last contact {r.daysWaiting === 0 ? "today" : `${r.daysWaiting} day${r.daysWaiting > 1 ? "s" : ""} ago`} · reminders sent {r.remindersSent}/2
                </div>
                {msg[r.candidateId] && <p role="alert" className="mt-1 text-xs text-block">{msg[r.candidateId]}</p>}
              </div>
              <div className="flex gap-2">
                {r.state === "due" && (
                  <button onClick={() => act(r, "prepare")} disabled={!!busy} className="btn btn-sm btn-primary">
                    {busy === r.candidateId ? "Drafting…" : "Prepare reminder"}
                  </button>
                )}
                {r.state === "pending_approval" && <Link href="/approvals" className="btn btn-sm">Review draft</Link>}
                <button onClick={() => act(r, "replied")} disabled={!!busy} className="btn btn-sm btn-ghost">They replied</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
