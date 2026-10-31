import { NextResponse } from "next/server";
import { requireUser, audit } from "@/lib/supabase/server";
import { anonymize } from "@/lib/security/anonymize";
import { BIAS_PROFILES, BIAS_BODY } from "@/lib/security/bias-suite";
import { rankResume } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Consistency test: the SAME CV is scored 5 times. A fair tool must give (almost) the same score every time.
export async function POST() {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`consist:${ctx.user.id}`, 1, 60_000)) return NextResponse.json({ error: "Wait a minute between runs." }, { status: 429 });

  const cv = anonymize(`${BIAS_PROFILES[0].header}\n${BIAS_BODY}`).text;
  const job = { title: "Full-Stack Developer (React / Node.js)", description: "B2B SaaS web platform.",
    criteria: ["2+ years web development", "React and TypeScript", "Node.js REST APIs", "PostgreSQL", "Git", "Bonus: Docker or cloud"] };
  const scores: number[] = [];
  const errors: string[] = [];
  for (let i = 0; i < 5; i++) {
    try { scores.push((await rankResume(job, cv)).score); } catch (e) { errors.push(String(e).slice(0, 80)); }
    if (i < 4) await new Promise((r) => setTimeout(r, 4200));
  }
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : null;
  await audit(ctx, "system", "security.consistency_test_run", "security", null, { scores, spread });
  return NextResponse.json({ scores, spread, errors });
}
