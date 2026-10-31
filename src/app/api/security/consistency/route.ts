import { NextResponse } from "next/server";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { anonymize } from "@/lib/security/anonymize";
import { BIAS_PROFILES, BIAS_BODY } from "@/lib/security/bias-suite";
import { rankResume } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Consistency test: the SAME CV is scored 5 times. A fair tool must give (almost) the same score every time.
export async function POST() {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  if (!rateLimit(`consist:${ctx.user.id}`, 1, 60_000)) return NextResponse.json({ error: "Wait a minute between runs." }, { status: 429 });

  const strong = anonymize(`${BIAS_PROFILES[0].header}\n${BIAS_BODY}`).text;
  const mid = `Web Developer\n\nPROFILE\nWeb Developer with 2 year(s) of experience.\n\nEXPERIENCE\n- Developed e-commerce front-ends in React for local retailers\n- Maintained Node.js APIs connected to MongoDB\n- Participated in weekly code reviews\n\nSKILLS\nReact, JavaScript, Node.js, MongoDB, Git\n\nLANGUAGES\nFrench (fluent), English (intermediate)`;
  const job = { title: "Full-Stack Developer (React / Node.js)", description: "B2B SaaS web platform.",
    criteria: ["2+ years web development", "React and TypeScript", "Node.js REST APIs", "PostgreSQL", "Git", "Bonus: Docker or cloud"] };
  const errors: string[] = [];
  const runs = async (cv: string) => {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      try { out.push((await rankResume(job, cv)).score); } catch (e) { errors.push(String(e).slice(0, 80)); }
      await new Promise((r) => setTimeout(r, 4200));
    }
    return out;
  };
  const sp = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  const strongScores = await runs(strong);
  const midScores = await runs(mid);
  const spread = Math.max(sp(strongScores), sp(midScores));
  await audit(ctx, "system", "security.consistency_test_run", "security", null, { strongScores, midScores, spread });
  return NextResponse.json({ groups: [{ label: "Strong CV (4 runs)", scores: strongScores }, { label: "Mid-level CV (4 runs)", scores: midScores }], spread, errors });
}
