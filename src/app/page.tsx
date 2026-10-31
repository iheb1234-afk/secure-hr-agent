"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Job = { id: string; title: string; description: string; criteria: string[] };
type Cand = {
  id: string; code: string; file_name: string; status: string; score: number | null; justification: string | null;
  matched_criteria: string[]; missing_criteria: string[]; injection_flag: boolean; injection_reasons: string[];
  hidden_text: string | null; anonymized_text: string;
};

const STATUS_STYLE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700", ranked: "bg-blue-100 text-blue-700", flagged: "bg-red-100 text-red-700",
  shortlisted: "bg-green-100 text-green-700", rejected: "bg-slate-200 text-slate-500", review: "bg-amber-100 text-amber-700",
};

export default function Dashboard() {
  const sb = supabaseBrowser();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [cands, setCands] = useState<Cand[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);

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
    setBusy("upload"); setMsg(`Scanning ${files.length} resumes for hidden text & injections…`);
    const fd = new FormData();
    fd.append("jobId", jobId);
    Array.from(files).forEach((f) => fd.append("files", f));
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await res.json();
    if (!res.ok) setMsg(j.error);
    else {
      const flagged = j.results.filter((r: { flagged?: boolean }) => r.flagged).length;
      const failed = j.results.filter((r: { ok: boolean }) => !r.ok);
      const note = j.results.find((r: { note?: string }) => r.note)?.note;
      setMsg(`${note ? `⚠️ ${note} · ` : ""}${j.results.length - failed.length} ingested · ${flagged} flagged 🚩${failed.length ? ` · ${failed.length} rejected: ${failed.map((f: { file: string; error: string }) => `${f.file} (${f.error})`).join(", ")}` : ""}`);
    }
    setBusy(""); loadCands();
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

  async function act(id: string, action: string) {
    setBusy(id);
    const res = await fetch(`/api/candidates/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await res.json();
    setMsg(j.warning ?? (action === "release" ? "Released for ranking (visible text only)." : "Decision saved. Draft reply waiting in the Approval queue."));
    setBusy(""); loadCands();
  }

  async function reset() {
    if (!window.confirm || !confirm("Delete all candidates of this job? (admin only)")) return;
    setBusy("reset");
    const res = await fetch("/api/jobs/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
    const j = await res.json();
    setMsg(res.ok ? `Reset: ${j.deleted} candidates deleted.` : j.error);
    setBusy(""); loadCands();
  }

  const job = jobs.find((j) => j.id === jobId);
  const flagged = cands.filter((c) => c.status === "flagged");
  const ranked = cands.filter((c) => c.score !== null && c.status !== "flagged").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const pending = cands.filter((c) => c.status === "new");

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <div>
          <label className="text-xs font-medium text-slate-500">Job offer</label>
          <select className="block min-w-72 rounded border px-3 py-2" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        {!jobs.length && <button onClick={seed} disabled={!!busy} className="rounded bg-slate-800 px-3 py-2 text-white">Create demo job offers</button>}
        {job && (
          <>
            <label className={`cursor-pointer rounded bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700 ${busy ? "pointer-events-none opacity-50" : ""}`}>
              Upload resumes (PDF/TXT)
              <input type="file" multiple accept=".pdf,.txt" className="hidden" onChange={(e) => upload(e.target.files)} />
            </label>
            <button onClick={rank} disabled={!!busy || !pending.length} className="rounded bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 disabled:opacity-40">
              Rank {pending.length} resumes with AI
            </button>
            {cands.length > 0 && <button onClick={reset} disabled={!!busy} className="ml-auto rounded border px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">Reset demo</button>}
          </>
        )}
        {msg && <p className="w-full text-sm text-slate-600">{busy && "⏳ "}{msg}</p>}
      </section>

      {job && (
        <p className="text-xs text-slate-500"><b>Criteria:</b> {job.criteria.join(" · ")}</p>
      )}

      {flagged.length > 0 && (
        <section className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <h2 className="mb-2 font-semibold text-red-700">🚩 Blocked: manipulation attempts ({flagged.length})</h2>
          <p className="mb-3 text-xs text-red-700">Excluded from AI ranking. A human must review before anything happens.</p>
          {flagged.map((c) => (
            <div key={c.id} className="mb-2 rounded border border-red-200 bg-white p-3 text-sm">
              <div className="flex items-center gap-2">
                <b>{c.code}</b><span className="text-slate-400">{c.file_name}</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => act(c.id, "release")} disabled={!!busy} className="rounded border px-2 py-1 text-xs">Release (rank visible text only)</button>
                  <button onClick={() => act(c.id, "reject")} disabled={!!busy} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Reject</button>
                </div>
              </div>
              <ul className="mt-1 list-disc pl-5 text-xs text-red-700">{c.injection_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              {c.hidden_text && <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs text-amber-300">Hidden text found: “{c.hidden_text}”</pre>}
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border bg-white">
        <h2 className="border-b p-4 font-semibold">Ranked shortlist <span className="text-xs font-normal text-slate-500">(anonymized: the AI never saw names, gender, age or address)</span></h2>
        {!ranked.length && <p className="p-4 text-sm text-slate-500">Upload resumes, then click “Rank”.</p>}
        {ranked.map((c, i) => (
          <div key={c.id} className="border-b p-4 last:border-0">
            <div className="flex items-center gap-3">
              <span className="w-6 text-slate-400">#{i + 1}</span>
              <b>{c.code}</b>
              <div className="h-2 w-32 rounded bg-slate-100"><div className="h-2 rounded bg-indigo-500" style={{ width: `${c.score}%` }} /></div>
              <b className="w-10">{c.score}</b>
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>{c.status}</span>
              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="text-xs text-indigo-600">details</button>
              {c.status === "ranked" && (
                <div className="ml-auto flex gap-2">
                  <button onClick={() => act(c.id, "shortlist")} disabled={!!busy} className="rounded bg-green-600 px-2 py-1 text-xs text-white">Shortlist</button>
                  <button onClick={() => act(c.id, "review")} disabled={!!busy} className="rounded bg-amber-500 px-2 py-1 text-xs text-white">Ask info</button>
                  <button onClick={() => act(c.id, "reject")} disabled={!!busy} className="rounded bg-slate-500 px-2 py-1 text-xs text-white">Reject</button>
                </div>
              )}
            </div>
            <p className="ml-9 mt-1 text-sm text-slate-600">{c.justification}</p>
            {open === c.id && (
              <div className="ml-9 mt-2 grid gap-2 text-xs md:grid-cols-2">
                <div><b className="text-green-700">✓ Matched</b><ul className="list-disc pl-4">{c.matched_criteria?.map((m, k) => <li key={k}>{m}</li>)}</ul></div>
                <div><b className="text-red-700">✗ Missing</b><ul className="list-disc pl-4">{c.missing_criteria?.map((m, k) => <li key={k}>{m}</li>)}</ul></div>
                <pre className="col-span-full max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{c.anonymized_text}</pre>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
