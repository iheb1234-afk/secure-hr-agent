import { NextResponse } from "next/server";
import { requireUser, audit } from "@/lib/supabase/server";
import { rankResume } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`rank:${ctx.user.id}`, 5, 60_000))
    return NextResponse.json({ error: "Too many requests, wait a minute." }, { status: 429 });

  const { jobId } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/.test(String(jobId))) return NextResponse.json({ error: "Invalid job" }, { status: 400 });

  const { data: job } = await ctx.sb.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Flagged resumes are NEVER auto-ranked: only 'new' ones
  const { data: cands } = await ctx.sb
    .from("candidates").select("id,code,anonymized_text").eq("job_id", jobId).eq("status", "new").limit(8);
  if (!cands?.length) return NextResponse.json({ ranked: 0, remaining: 0 });

  let ranked = 0;
  const errors: string[] = [];
  const queue = [...cands];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const r = await rankResume(job, c.anonymized_text);
        await ctx.sb.from("candidates").update({
          score: r.score, justification: r.justification,
          matched_criteria: r.matched_criteria, missing_criteria: r.missing_criteria, status: "ranked",
        }).eq("id", c.id);
        await audit(ctx, "ai", "resume.ranked", "candidates", c.id, { code: c.code, score: r.score });
        ranked++;
      } catch (e) {
        errors.push(`${c.code}: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
      }
    }
  };
  await Promise.all([worker(), worker()]); // 2 in parallel (free-tier friendly)

  const { count } = await ctx.sb.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "new");
  return NextResponse.json({ ranked, remaining: count ?? 0, errors });
}
