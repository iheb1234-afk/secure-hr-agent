import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { suggestCriteria, isCanaryLeak } from "@/lib/ai/gemini";
import { unfairCriterion } from "@/lib/security/fair-criteria";
import { scanRules } from "@/lib/security/injection";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().min(20).max(3000) });

// The AI PROPOSES criteria from the job ad. Nothing is saved here: the recruiter edits, then saves.
export async function POST(req: Request) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  if (!rateLimit(`suggest:${ctx.user.id}`, 5, 60_000)) return NextResponse.json({ error: "Too many suggestions, wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Write a title and a description (20+ characters) first." }, { status: 400 });
  const { title, description } = parsed.data;

  try {
    const r = await suggestCriteria(title, description);
    // double check on our side: unfair or manipulative suggestions never reach the form
    const criteria = r.criteria.filter((c) => !unfairCriterion(c) && !scanRules(c).flagged);
    await audit(ctx, "ai", "job.criteria_suggested", "jobs", null, { suggested: r.criteria.length, removed: r.criteria.length - criteria.length });
    return NextResponse.json({ criteria });
  } catch (e) {
    if (isCanaryLeak(e)) return NextResponse.json({ error: "The job ad made the AI leak its instructions. Write the criteria yourself." }, { status: 422 });
    return NextResponse.json({ error: `AI unavailable: ${String(e).slice(0, 100)}. Write the criteria yourself.` }, { status: 502 });
  }
}
