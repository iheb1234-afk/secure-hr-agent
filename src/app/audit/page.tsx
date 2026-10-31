import { requireUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
const WHO: Record<string, { label: string; cls: string }> = {
  human: { label: "Human", cls: "bg-human-soft text-human" },
  ai: { label: "AI", cls: "bg-ai-soft text-ai" },
  system: { label: "System", cls: "bg-wash text-ink-2" },
};
const isThreat = (a: string) => /flag|block|inject/i.test(a);

// Admin only (also enforced by Row Level Security in the database)
export default async function Audit({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireUser();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") return <p className="panel px-5 py-10 text-center text-sm text-block">Only admins can read the audit log.</p>;
  const { view } = await searchParams;
  const { data } = await ctx.sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
  const { data: profs } = await ctx.sb.from("profiles").select("id,email");
  const emailOf = new Map((profs ?? []).map((p) => [p.id, p.email]));
  const rows = (data ?? []).filter((r) => view !== "threats" || isThreat(r.action));
  const tab = (v: string | undefined, label: string) => (
    <Link href={v ? `/audit?view=${v}` : "/audit"} aria-current={view === v ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm ${view === v ? "bg-ink text-white" : "text-ink-2 hover:bg-wash"}`}>{label}</Link>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Audit log</h1>
        <p className="page-lede">Append-only: every AI output and every human decision. The database refuses edits and deletes, for everyone.</p>
      </header>
      <div className="flex gap-1">{tab(undefined, "All events")}{tab("threats", "Threats only")}</div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-paper text-xs text-ink-3">
            <tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">Who</th><th className="px-4 py-2.5 font-medium">Action</th><th className="px-4 py-2.5 font-medium">Details</th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const w = WHO[r.actor_type] ?? WHO.system;
              return (
                <tr key={r.id} className={isThreat(r.action) ? "bg-block-soft/50" : ""}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-2">{new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" })}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs"><span className={`chip mr-1.5 ${w.cls}`}>{w.label}</span><span className="text-ink-3">{emailOf.get(r.actor)}</span></td>
                  <td className={`px-4 py-2 font-mono text-xs ${isThreat(r.action) ? "text-block" : ""}`}>{r.action}</td>
                  <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-ink-3" title={JSON.stringify(r.details)}>{JSON.stringify(r.details).slice(0, 160)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-2">No events here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
