import { NextResponse } from "next/server";
import { requireUser, audit } from "@/lib/supabase/server";

// Admin only: delete all candidates (and their drafts) of a job, to re-run the demo
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { jobId } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/.test(String(jobId))) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  const { error, count } = await ctx.sb.from("candidates").delete({ count: "exact" }).eq("job_id", jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await audit(ctx, "human", "job.reset", "jobs", jobId, { deleted: count });
  return NextResponse.json({ deleted: count });
}
