"use client";
import { useState } from "react";

// New job offer. The AI can PROPOSE criteria from the ad; the recruiter edits them and saves.
export default function NewJob({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [fromAI, setFromAI] = useState(false);
  const [busy, setBusy] = useState<"" | "suggest" | "save">("");
  const [err, setErr] = useState("");

  const list = criteria.split("\n").map((c) => c.trim()).filter(Boolean);

  async function suggest() {
    setBusy("suggest"); setErr("");
    const r = await fetch("/api/jobs/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description }) });
    const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
    if (!r.ok) setErr(j.error);
    else { setCriteria(j.criteria.join("\n")); setFromAI(true); }
    setBusy("");
  }

  async function save() {
    setBusy("save"); setErr("");
    const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description, criteria: list, aiSuggested: fromAI }) });
    const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
    setBusy("");
    if (!r.ok) setErr(j.error); else onCreated(j.id);
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b px-5 py-3.5">
        <h2 className="section-title">New job offer</h2>
        <p className="text-xs text-ink-3">Every resume is scored against these criteria only, so keep them about the job: skills, experience, qualifications.</p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Job title</span>
          <input className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backend Developer (Python)" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Job description</span>
          <textarea className="field h-28 resize-y" value={description} maxLength={3000} onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the job ad: the team, the missions, what you need." />
        </label>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Criteria, one per line</span>
            {fromAI && <span className="chip bg-ai-soft text-ai ring-1 ring-ai/20">Suggested by AI, check them</span>}
            <button type="button" onClick={suggest} disabled={!!busy || title.trim().length < 3 || description.trim().length < 20}
              className="btn btn-sm btn-ghost ml-auto">{busy === "suggest" ? "Reading the ad…" : "Suggest from the description"}</button>
          </div>
          <textarea className="field h-36 resize-y leading-relaxed" value={criteria} onChange={(e) => setCriteria(e.target.value)}
            placeholder={"2+ years of Python in production\nSQL (PostgreSQL or MySQL)\nREST API design\nBonus: Docker"} />
          <p className="mt-1 text-xs text-ink-3">{list.length} criteria. Start a line with &ldquo;Bonus:&rdquo; for nice-to-haves. Age, gender, origin, religion, family status or appearance are refused.</p>
        </div>
        {err && <p role="alert" className="rounded-md bg-block-soft px-3 py-2 text-sm text-block">{err}</p>}
      </div>
      <div className="flex gap-2 border-t bg-paper/60 px-5 py-3">
        <button onClick={save} disabled={!!busy || title.trim().length < 3 || description.trim().length < 20 || list.length < 2} className="btn btn-primary">
          {busy === "save" ? "Saving…" : "Save job offer"}
        </button>
        <button onClick={onCancel} disabled={!!busy} className="btn btn-ghost">Cancel</button>
      </div>
    </section>
  );
}
