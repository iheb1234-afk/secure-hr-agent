"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import NewJob from "./new-job";
import { REJECT_REASONS, NOTE_MIN, needsNote } from "@/lib/decisions";

type Job = { id: string; title: string; description: string; criteria: string[] };
type Cand = {
  id: string; code: string; file_name: string; status: string; score: number | null; justification: string | null;
  matched_criteria: string[]; missing_criteria: string[]; injection_flag: boolean; injection_reasons: string[];
  hidden_text: string | null; anonymized_text: string;
  decision_reason: string | null; decision_note: string | null;
};
type Decide = { id: string; action: "shortlist" | "reject"; reason: string; note: string; error?: string };

// who acted last: amber = AI output waiting for a human, green = a human decided
const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "Not ranked yet", cls: "bg-wash text-ink-2" },
  ranked: { label: "AI scored, your call", cls: "bg-ai-soft text-ai" },
  flagged: { label: "Quarantined", cls: "bg-block-soft text-block" },
  shortlisted: { label: "Shortlisted by you", cls: "bg-human-soft text-human" },
  rejected: { label: "Rejected by you", cls: "bg-wash text-ink-3" },
  review: { label: "Info requested", cls: "bg-human-soft text-human" },
};

export default function Dashboard() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [cands, setCands] = useState<Cand[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [decide, setDecide] = useState<Decide | null>(null);
  const [creating, setCreating] = useState(false);

  const loadJobs = useCallback(async () => {
    const { data } = await sb.from("jobs").select("*").order("created_at");
    setJobs(data ?? []);
    if (data?.length && !jobId) setJobId(data[0].id);
  }, [sb, jobId]);

  const loadCands = useCallback(async () => {
    if (!jobId) return;
    const { data } = await sb.from("candidates").select("*").eq("job_id", jobId);
    setCands(data ?? []);
  }, [sb, jobId]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { loadCands(); }, [loadCands]);

  async function seed() {
    setBusy("seed");
    await fetch("/api/jobs/seed", { method: "POST" });
    setBusy(""); loadJobs();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    const all = Array.from(files);
    type R = { file: string; ok: boolean; flagged?: boolean; error?: string; note?: string };
    const results: R[] = [];
    // batches of 5 so each request stays under the serverless time limit
    for (let i = 0; i < all.length; i += 5) {
      setMsg(`Scanning resumes for hidden text & injections… ${i}/${all.length}`);
      const fd = new FormData();
      fd.append("jobId", jobId);
      all.slice(i, i + 5).forEach((f) => fd.append("files", f));
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
      if (!res.ok) { setMsg(j.error); setBusy(""); loadCands(); return; }
      results.push(...j.results);
      loadCands();
    }
    const flagged = results.filter((r) => r.flagged).length;
    const failed = results.filter((r) => !r.ok);
    const note = results.find((r) => r.note)?.note;
    setMsg(`${note ? `${note}. ` : ""}${results.length - failed.length} resumes scanned, ${flagged} quarantined.${failed.length ? ` ${failed.length} refused: ${failed.map((f) => `${f.file} (${f.error})`).join(", ")}` : ""}`);
    setBusy(""); loadCands(); router.refresh();
  }

  async function rank() {
    setBusy("rank");
    let remaining = 1, total = 0;
    while (remaining > 0) {
      setMsg(`AI is ranking anonymized resumes… ${total} done`);
      const res = await fetch("/api/rank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error); setBusy(""); return; }
      total += j.ranked; remaining = j.ranked === 0 ? 0 : j.remaining;
      await loadCands();
      if (j.ranked === 0 && j.errors?.length) { setMsg(`AI error: ${j.errors[0]}`); setBusy(""); return; }
    }
    setMsg(`Ranking done (${total} resumes). Review and decide.`);
    setBusy("");
  }

  async function act(id: string, action: string, extra: { reason?: string; note?: string } = {}) {
    setBusy(id);
    const res = await fetch(`/api/candidates/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      // the server asks for a reason or a note: keep the panel open and show why
      if (j.needsNote || j.needsReason) setDecide((d) => (d ? { ...d, error: j.error } : d));
      else setMsg(j.error ?? "Error");
      return;
    }
    setDecide(null);
    setMsg(j.warning ?? (action === "release" ? "Released for ranking (visible text only)." : "Decision saved. Draft reply waiting in the Approval queue."));
    loadCands(); router.refresh();
  }

  // Reject always asks for a reason; shortlisting against the AI's score asks for a note
  function start(c: Cand, action: "shortlist" | "reject") {
    if (action === "shortlist" && !needsNote("shortlist", c.score)) return act(c.id, "shortlist");
    setDecide({ id: c.id, action, reason: c.status === "flagged" ? "Manipulation attempt in the resume" : "", note: "" });
  }

  function decidePanel(c: Cand) {
    if (decide?.id !== c.id) return null;
    const d = decide;
    const rule = needsNote(d.action, c.score, d.reason || undefined);
    const ready = (d.action === "shortlist" || d.reason) && (!rule || d.note.trim().length >= NOTE_MIN);
    return (
      <div className="mt-3 space-y-2 rounded-md border bg-paper p-3 text-sm sm:ml-9">
        {d.action === "reject" && (
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Reason (recorded, never shown to the candidate)</span>
            <select className="field" value={d.reason} onChange={(e) => setDecide({ ...d, reason: e.target.value, error: undefined })}>
              <option value="">Pick a reason…</option>
              {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {rule && <p className="text-xs font-medium text-ai">{rule}</p>}
        <label className="block">
          <span className="mb-1 block text-xs text-ink-3">{rule ? `Your note (required, ${NOTE_MIN}+ characters)` : "Internal note (optional)"}</span>
          <textarea className="field h-16 resize-y" maxLength={500} value={d.note} onChange={(e) => setDecide({ ...d, note: e.target.value, error: undefined })} />
        </label>
        {d.error && <p role="alert" className="text-xs text-block">{d.error}</p>}
        <div className="flex gap-2">
          <button disabled={!ready || !!busy} onClick={() => act(c.id, d.action, { reason: d.reason || undefined, note: d.note.trim() || undefined })}
            className={`btn btn-sm ${d.action === "reject" ? "btn-block" : "btn-approve"}`}>
            {d.action === "reject" ? "Confirm rejection" : "Confirm shortlist"}
          </button>
          <button onClick={() => setDecide(null)} className="btn btn-sm btn-ghost">Cancel</button>
        </div>
      </div>
    );
  }

  async function reset() {
    if (!window.confirm || !confirm("Delete all candidates of this job? (admin only)")) return;
    setBusy("reset");
    const res = await fetch("/api/jobs/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
    const j = await res.json();
    setMsg(res.ok ? `Reset: ${j.deleted} candidates deleted.` : j.error);
    setBusy(""); loadCands(); router.refresh();
  }

  const job = jobs.find((j) => j.id === jobId);
  const flagged = cands.filter((c) => c.status === "flagged");
  const ranked = cands.filter((c) => c.score !== null && c.status !== "flagged").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const pending = cands.filter((c) => c.status === "new");
  const closedUnranked = cands.filter((c) => c.status === "rejected" && c.score === null);
  const decided = cands.filter((c) => ["shortlisted", "rejected", "review"].includes(c.status)).length;
  // every resume ever caught, including the ones a human has since rejected or released
  const caught = cands.filter((c) => c.injection_flag).length;
  const steps = [
    { n: cands.length, label: "Scanned for hidden text and manipulation" },
    { n: caught, label: "Caught trying to manipulate the AI", tone: "text-block" },
    { n: ranked.length, label: "Scored by the AI on anonymized text", tone: "text-ai" },
    { n: decided, label: "Decided by a human", tone: "text-human" },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="w-full min-w-0 xl:w-auto xl:flex-1">
          <label htmlFor="job" className="text-sm text-ink-3">Screening for</label>
          {jobs.length ? (
            <select id="job" className="-ml-1 block w-full cursor-pointer whitespace-normal rounded-md bg-transparent py-0.5 pr-2 text-[1.5rem] font-semibold leading-tight text-ink hover:bg-wash focus:outline-none md:text-[1.75rem]"
              value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          ) : <h1 className="page-title">No job offer yet</h1>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!jobs.length && <button onClick={seed} disabled={!!busy} className="btn btn-primary">Create demo job offers</button>}
          {!creating && <button onClick={() => setCreating(true)} disabled={!!busy} className="btn btn-ghost">New job offer</button>}
          {job && cands.length > 0 && <button onClick={reset} disabled={!!busy} className="btn btn-ghost text-ink-3">Reset demo</button>}
          {job && (
            <label className={`btn btn-ghost cursor-pointer ${busy ? "pointer-events-none opacity-40" : ""}`}>
              Upload resumes
              <input type="file" multiple accept=".pdf,.txt" className="sr-only" onChange={(e) => upload(e.target.files)} />
            </label>
          )}
          {job && (
            <button onClick={rank} disabled={!!busy || !pending.length} className="btn btn-primary">
              Rank {pending.length} with AI
            </button>
          )}
        </div>
        {job && (
          <div className="flex w-full flex-wrap gap-1.5">
            {job.criteria.map((c) => <span key={c} className="chip border bg-white font-normal text-ink-2">{c}</span>)}
          </div>
        )}
        {msg && (
          <p role="status" className="flex w-full items-center gap-2 rounded-md bg-white px-3 py-2 text-sm text-ink-2 ring-1 ring-line">
            {busy && <span className="h-2 w-2 animate-pulse rounded-full bg-ai" />}{msg}
          </p>
        )}
      </header>

      {creating && (
        <NewJob onCancel={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setJobId(id); setMsg("Job offer saved. Upload resumes to start screening."); loadJobs(); }} />
      )}

      {cands.length > 0 && (
        <ol className="grid grid-cols-2 overflow-hidden rounded-[10px] border bg-white md:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.label} className={`relative px-4 py-3.5 ${i ? "border-l" : ""} ${i === 2 ? "max-md:border-l-0 max-md:border-t" : ""} ${i === 3 ? "max-md:border-t" : ""}`}>
              <div className={`text-2xl font-semibold tabular-nums ${s.tone ?? "text-ink"}`}>{s.n}</div>
              <div className="mt-0.5 text-xs leading-snug text-ink-2">{s.label}</div>
            </li>
          ))}
        </ol>
      )}

      {flagged.length > 0 && (
        <section className="overflow-hidden rounded-[10px] border border-block/30 bg-white">
          <div className="border-b border-block/20 bg-block-soft px-5 py-3.5">
            <h2 className="section-title text-block">Quarantine: {flagged.length} {flagged.length > 1 ? "resumes" : "resume"} tried to manipulate the AI</h2>
            <p className="mt-0.5 text-sm text-block/80">The ranking AI never saw these. Nothing happens until a person decides.</p>
          </div>
          <div className="divide-y">
            {flagged.map((c) => (
              <article key={c.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <b className="text-ink">{c.code}</b>
                  <span className="truncate text-sm text-ink-3">{c.file_name}</span>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => act(c.id, "release")} disabled={!!busy} className="btn btn-sm btn-ghost">Release, rank visible text only</button>
                    <button onClick={() => start(c, "reject")} disabled={!!busy} className="btn btn-sm btn-block">Reject</button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.injection_reasons.map((r, i) => <span key={i} className="chip bg-block-soft font-normal text-block">{r}</span>)}
                </div>
                {decidePanel(c)}
                {c.hidden_text && (
                  <figure className="mt-3">
                    <figcaption className="mb-1 text-xs text-ink-3">Invisible on the page. Revealed by reading the PDF&apos;s drawing instructions:</figcaption>
                    <blockquote className="uv">{c.hidden_text}</blockquote>
                  </figure>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-x-3 border-b px-5 py-3.5">
          <h2 className="section-title">Ranked shortlist</h2>
          <p className="text-xs text-ink-3">The AI scored anonymized text: no names, gender, age, photo or address.</p>
        </div>
        {!ranked.length && (
          <p className="px-5 py-10 text-center text-sm text-ink-2">
            {cands.length ? "Click Rank to score the resumes that passed the security scan." : "Upload resumes to start. Each file is scanned before any AI reads it."}
          </p>
        )}
        <ul className="divide-y">
          {ranked.map((c, i) => {
            const st = STATUS[c.status] ?? STATUS.new;
            // count against the job's own criteria (the AI sometimes splits one criterion in two)
            const crit = job?.criteria ?? [];
            const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const matchedSet = new Set((c.matched_criteria ?? []).map(norm));
            let met = crit.filter((cr) => matchedSet.has(norm(cr))).length;
            if (!met && matchedSet.size) met = Math.min(matchedSet.size, crit.length); // AI paraphrased: fall back to its count
            const total = crit.length;
            return (
              <li key={c.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="w-5 text-sm tabular-nums text-ink-3">{i + 1}</span>
                  <div className="flex w-28 items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums">{c.score}</span>
                    <span className="text-xs text-ink-3">/100</span>
                  </div>
                  <div className="min-w-0">
                    <b className="text-ink">{c.code}</b>
                    {total > 0 && (
                      <span className="ml-3 inline-flex items-center gap-2 text-xs text-ink-2">
                        <span className="flex gap-[3px]" aria-hidden>
                          {Array.from({ length: total }, (_, k) => (
                            <i key={k} className={`h-2 w-2 rounded-full ${k < met ? "bg-human" : "ring-1 ring-inset ring-ink-3/50"}`} />
                          ))}
                        </span>
                        {met} of {total} criteria met
                      </span>
                    )}
                  </div>
                  <span className={`chip ${st.cls}`}>{st.label}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} className="btn btn-sm text-ink-2 hover:bg-wash">
                      {open === c.id ? "Hide evidence" : "Evidence"}
                    </button>
                    {c.status === "ranked" && (
                      <>
                        <button onClick={() => start(c, "shortlist")} disabled={!!busy} className="btn btn-sm btn-approve">Shortlist</button>
                        <button onClick={() => act(c.id, "review")} disabled={!!busy} className="btn btn-sm btn-ghost">Ask for info</button>
                        <button onClick={() => start(c, "reject")} disabled={!!busy} className="btn btn-sm btn-ghost">Reject</button>
                      </>
                    )}
                    {(c.status === "review" || c.status === "shortlisted") && (
                      <button onClick={() => start(c, "reject")} disabled={!!busy} className="btn btn-sm btn-ghost">Reject</button>
                    )}
                    {c.status === "rejected" && (
                      <button onClick={() => act(c.id, "restore")} disabled={!!busy} className="btn btn-sm btn-ghost">Undo rejection</button>
                    )}
                  </div>
                </div>
                <div className="ml-9 mt-2 h-1 max-w-md overflow-hidden rounded-full bg-wash">
                  <div className="h-full rounded-full bg-ink/70" style={{ width: `${c.score}%` }} />
                </div>
                <p className="ml-9 mt-2 max-w-[75ch] text-sm leading-relaxed text-ink-2">{c.justification}</p>
                {c.decision_reason && <p className="ml-9 mt-1 text-xs text-ink-3">Your reason: {c.decision_reason}{c.decision_note ? `: ${c.decision_note}` : ""}</p>}
                {!c.decision_reason && c.decision_note && <p className="ml-9 mt-1 text-xs text-ink-3">Your note: {c.decision_note}</p>}
                {decidePanel(c)}
                {open === c.id && (
                  <div className="ml-9 mt-3 grid gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="mb-1.5 text-xs font-semibold text-human">Criteria met</h3>
                      <ul className="space-y-1 text-sm">{c.matched_criteria?.map((m, k) => <li key={k} className="flex gap-2"><span className="text-human">✓</span>{m}</li>)}</ul>
                    </div>
                    <div>
                      <h3 className="mb-1.5 text-xs font-semibold text-block">Criteria missing</h3>
                      <ul className="space-y-1 text-sm">{c.missing_criteria?.map((m, k) => <li key={k} className="flex gap-2"><span className="text-block">✕</span>{m}</li>)}</ul>
                    </div>
                    <div className="md:col-span-2">
                      <h3 className="mb-1.5 text-xs font-semibold text-ink-2">Exactly what the AI read (anonymized)</h3>
                      <pre className="doc max-h-56 overflow-auto rounded-md bg-paper p-3 text-ink-2">{c.anonymized_text}</pre>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {closedUnranked.length > 0 && (
        <section className="panel overflow-hidden">
          <h2 className="section-title border-b px-5 py-3">Rejected before ranking</h2>
          <ul className="divide-y">
            {closedUnranked.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <b>{c.code}</b>
                <span className="text-ink-3">{c.decision_reason ?? "Rejected"}{c.decision_note ? `: ${c.decision_note}` : ""}</span>
                <button onClick={() => act(c.id, "restore")} disabled={!!busy} className="btn btn-sm btn-ghost ml-auto">Undo rejection</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
