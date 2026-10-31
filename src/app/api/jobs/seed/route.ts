import { NextResponse } from "next/server";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import jobs from "@/lib/demo-jobs.json";

// Creates the 2 fictional demo job offers
export async function POST() {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.sb.from("jobs").insert(jobs).select("id,title");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await audit(ctx, "human", "jobs.seeded", "jobs", null, { count: data.length });
  return NextResponse.json({ jobs: data });
}
