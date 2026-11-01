import { requireUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TestRunner from "./test-runner";
import BiasRunner from "./bias-runner";
import ConsistencyRunner from "./consistency-runner";
import Playground from "./playground";

export const dynamic = "force-dynamic";

export default async function Security() {
  const ctx = await requireUser();
  if (!ctx) redirect("/login");
  if (ctx.role === "employee") redirect("/ask");
  const { data: cands } = await ctx.sb.from("candidates").select("code,file_name,injection_flag,injection_reasons,hidden_text,status,created_at");
  const { count: drafts } = await ctx.sb.from("drafts").select("id", { count: "exact", head: true });
  const { count: sent } = await ctx.sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "sent");
  const { count: discarded } = await ctx.sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "discarded");

  const all = cands ?? [];
  const flagged = all.filter((c) => c.injection_flag);
  const hidden = flagged.filter((c) => c.hidden_text);
  const reasons = flagged.flatMap((c) => (c.injection_reasons as string[]) ?? []);
  const byType: Record<string, number> = {};
  for (const r of reasons) { const k = r.replace(/^Hidden text: /, "Hidden: ").replace(/ \(FR\)$/, ""); byType[k] = (byType[k] ?? 0) + 1; }

  const stats = [
    { n: all.length, label: "resumes scanned before any AI read them" },
    { n: flagged.length, label: "manipulation attempts quarantined", tone: "text-block" },
    { n: hidden.length, label: "with hidden text (white, tiny or off-page)", tone: "text-block" },
    { n: all.length, label: "anonymized before ranking" },
    { n: `${sent ?? 0}/${drafts ?? 0}`, label: `AI drafts sent after a human approved (${discarded ?? 0} discarded)`, tone: "text-human" },
  ];
  const layers = [
    { t: "Hidden-text detector", d: "Reads the PDF's drawing instructions (color, font size, position) to find text a person can't see." },
    { t: "Unicode check", d: "Invisible tag characters, direction tricks and look-alike letters." },
    { t: "Rule engine", d: "Known manipulation patterns, in English and French." },
    { t: "AI security classifier", d: "A separate model call that only answers: is this an attack? If it fails, the file is held, not passed." },
    { t: "Guarded prompt", d: "The resume is wrapped as untrusted data, only visible anonymized text is sent, and the output must match a strict schema." },
    { t: "Canary token", d: "Every AI call hides a fresh secret code in its instructions. If the code ever appears in the answer, the input hijacked the model: the answer is thrown away and the file goes to quarantine." },
    { t: "Output check", d: "Before an email leaves, code blocks leftover placeholders, hidden tracking images and links built to smuggle data out." },
    { t: "Human gate", d: "The AI cannot send or decide anything. Every step lands in the append-only audit log." },
  ];
  const max = Math.max(1, ...Object.values(byType));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="page-title">Security Lab</h1>
        <p className="page-lede">Live numbers from the database, and tests you can run in front of anyone.</p>
      </header>

      <dl className="grid grid-cols-2 overflow-hidden rounded-[10px] border bg-white md:grid-cols-5">
        {stats.map((s, i) => (
          <div key={s.label} className={`px-4 py-3.5 ${i ? "md:border-l" : ""} ${i % 2 ? "max-md:border-l" : ""} ${i > 1 ? "max-md:border-t" : ""}`}>
            <dd className={`text-2xl font-semibold tabular-nums ${s.tone ?? "text-ink"}`}>{s.n}</dd>
            <dt className="mt-0.5 text-xs leading-snug text-ink-2">{s.label}</dt>
          </div>
        ))}
      </dl>

      <section className="grid gap-6 md:grid-cols-[1.15fr_1fr]">
        <div className="panel p-5">
          <h2 className="section-title">Eight layers, in this order</h2>
          <ol className="mt-4 space-y-0">
            {layers.map((l, i) => (
              <li key={l.t} className="relative flex gap-3 pb-4 last:pb-0">
                {i < layers.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-line" aria-hidden />}
                <span className={`z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${i === layers.length - 1 ? "bg-human text-white" : "bg-ink text-white"}`}>{i + 1}</span>
                <div className="text-sm"><b className="font-semibold">{l.t}</b><p className="text-ink-2">{l.d}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel p-5">
          <h2 className="section-title">What the attackers tried</h2>
          {!Object.keys(byType).length && <p className="mt-3 text-sm text-ink-2">Nothing caught yet. Upload the demo resumes to see it work.</p>}
          <ul className="mt-4 space-y-3">
            {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="text-sm">
                <div className="flex justify-between gap-3"><span>{k}</span><b className="tabular-nums">{v}</b></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full bg-block/80" style={{ width: `${(v / max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Playground />

      <TestRunner />

      <BiasRunner />

      <ConsistencyRunner />

      {!!flagged.length && (
        <section className="panel overflow-hidden">
          <h2 className="section-title border-b px-5 py-3">Quarantined resumes</h2>
          <div className="divide-y">
            {flagged.map((c) => (
              <div key={c.code + c.file_name} className="px-5 py-3.5 text-sm">
                <div className="flex flex-wrap items-center gap-2"><b>{c.code}</b><span className="text-ink-3">{c.file_name}</span></div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{(c.injection_reasons as string[]).map((r, i) => <span key={i} className="chip bg-block-soft font-normal text-block">{r}</span>)}</div>
                {c.hidden_text && <blockquote className="uv mt-2">{c.hidden_text.slice(0, 200)}</blockquote>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
