import { requireUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TestRunner from "./test-runner";
import BiasRunner from "./bias-runner";
import ConsistencyRunner from "./consistency-runner";

export const dynamic = "force-dynamic";

export default async function Security() {
  const ctx = await requireUser();
  if (!ctx) redirect("/login");
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

  const Stat = ({ n, label, tone }: { n: number | string; label: string; tone: string }) => (
    <div className={`rounded-xl border p-4 ${tone}`}><div className="text-3xl font-bold">{n}</div><div className="text-xs">{label}</div></div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">🛡️ Security Lab</h1>
        <p className="text-sm text-slate-500">Live view of the defenses. Every number below comes from the database.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Stat n={all.length} label="CVs scanned" tone="bg-white" />
        <Stat n={flagged.length} label="Manipulation attempts blocked" tone="bg-red-50 border-red-200 text-red-700" />
        <Stat n={hidden.length} label="CVs with hidden text" tone="bg-amber-50 border-amber-200 text-amber-800" />
        <Stat n={all.length} label="CVs anonymized before AI" tone="bg-indigo-50 border-indigo-200 text-indigo-700" />
        <Stat n={`${sent ?? 0}/${drafts ?? 0}`} label={`AI drafts approved by a human (${discarded ?? 0} discarded)`} tone="bg-green-50 border-green-200 text-green-700" />
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Attack types detected</h2>
          {!Object.keys(byType).length && <p className="text-sm text-slate-500">None yet.</p>}
          {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} className="mb-1 flex items-center gap-2 text-sm">
              <div className="h-2 rounded bg-red-400" style={{ width: `${Math.max(8, v * 30)}px` }} />
              <span className="w-6 font-mono">{v}</span><span>{k}</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">Defense layers</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li><b>Hidden-text detector</b>: reads PDF drawing instructions (color, font size, position) to find text a human can&apos;t see.</li>
            <li><b>Rule engine</b>: known manipulation patterns, English + French.</li>
            <li><b>AI security classifier</b>: a separate model call that only judges &quot;is this an attack?&quot;.</li>
            <li><b>Guarded prompts</b>: CV text is wrapped as untrusted data; the AI only sees visible, anonymized text; output is schema-validated.</li>
            <li><b>Human gate</b>: the AI can&apos;t send or decide anything. Every action is in the append-only audit log.</li>
          </ol>
        </div>
      </section>

      <TestRunner />

      <BiasRunner />

      <ConsistencyRunner />

      {!!flagged.length && (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Blocked CVs</h2>
          {flagged.map((c) => (
            <div key={c.code + c.file_name} className="border-b py-2 text-sm last:border-0">
              <b>{c.code}</b> <span className="text-slate-400">{c.file_name}</span> · <span className="text-red-600">{(c.injection_reasons as string[]).join(" · ")}</span>
              {c.hidden_text && <div className="mt-1 rounded bg-slate-900 p-2 font-mono text-xs text-amber-300">{c.hidden_text.slice(0, 200)}</div>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
