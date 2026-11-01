import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { scanRules } from "@/lib/security/injection";
import { unfairCriterion } from "@/lib/security/fair-criteria";
import { rateLimit } from "@/lib/security/ratelimit";

const Body = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(3000),
  criteria: z.array(z.string().trim().min(3).max(160)).min(2).max(12),
  aiSuggested: z.boolean().optional(),
});

// Creates a job offer. The criteria are what the AI scores every resume against,
// so they are checked twice: fairness (job-related only) and manipulation (they go into the ranking prompt).
export async function POST(req: Request) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  if (!rateLimit(`jobs:${ctx.user.id}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests, wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Fill in a title, a description (20+ characters) and 2 to 12 criteria." }, { status: 400 });
  const { title, description, criteria, aiSuggested } = parsed.data;

  for (const c of criteria) {
    const why = unfairCriterion(c);
    if (why) return NextResponse.json({ error: `"${c}" is about ${why}, not about the job. Rewrite or remove it.` }, { status: 422 });
  }
  const scan = scanRules([title, description, ...criteria].join("\n"));
  if (scan.flagged) {
    await audit(ctx, "system", "job.blocked_injection", "jobs", null, { reasons: scan.reasons });
    return NextResponse.json({ error: `Not saved: the text looks like instructions to the AI (${scan.reasons[0]}).` }, { status: 422 });
  }

  const { data, error } = await ctx.sb.from("jobs")
    .insert({ title, description, criteria, created_by: ctx.user.id }).select("id").single();
  if (error) return NextResponse.json({ error: "Could not save the job offer." }, { status: 500 });
  await audit(ctx, "human", "job.created", "jobs", data.id, { title, criteria: criteria.length, ai_suggested: !!aiSuggested });
  return NextResponse.json({ id: data.id });
}
