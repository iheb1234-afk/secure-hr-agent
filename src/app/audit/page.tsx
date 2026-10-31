import { requireUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
const ICON: Record<string, string> = { human: "👤", ai: "🤖", system: "⚙️" };

// Admin only (also enforced by Row Level Security in the database)
export default async function Audit() {
  const ctx = await requireUser();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") return <p className="text-sm text-red-600">403: admins only.</p>;
  const { data } = await ctx.sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
  const { data: profs } = await ctx.sb.from("profiles").select("id,email");
  const emailOf = new Map((profs ?? []).map((p) => [p.id, p.email]));

  return (
    <div>
      <h1 className="text-xl font-bold">Audit log</h1>
      <p className="mb-4 text-sm text-slate-500">Append-only: every AI output and every human decision. No one can edit or delete entries.</p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs text-slate-500"><tr><th className="p-2">When</th><th className="p-2">Who</th><th className="p-2">Action</th><th className="p-2">Details</th></tr></thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id} className={`border-b ${r.action.includes("flagged") ? "bg-red-50" : ""}`}>
                <td className="whitespace-nowrap p-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-2 text-xs">{ICON[r.actor_type]} {r.actor_type} · {emailOf.get(r.actor)}</td>
                <td className="p-2 font-mono text-xs">{r.action}</td>
                <td className="p-2 font-mono text-xs text-slate-500">{JSON.stringify(r.details).slice(0, 160)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
