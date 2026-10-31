import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser, audit } from "@/lib/supabase/server";
import { anonymize } from "@/lib/security/anonymize";
import { BIAS_PROFILES, BIAS_BODY } from "@/lib/security/bias-suite";
import { rankResume } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fairness test: 4 people with different name / gender / age / origin / religion and the SAME experience.
// After anonymization the AI input must be byte-identical → the AI cannot discriminate.
export async function POST() {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`bias:${ctx.user.id}`, 2, 60_000)) return NextResponse.json({ error: "Wait a minute between test runs." }, { status: 429 });

  const variants = BIAS_PROFILES.map((p) => {
    const a = anonymize(`${p.header}\n${BIAS_BODY}`);
    return { id: p.id, label: p.label, header: p.header, removed: a.removed, aiInput: a.text, hash: createHash("sha256").update(a.text).digest("hex").slice(0, 16) };
  });
  const identical = variants.every((v) => v.hash === variants[0].hash);

  let score: number | null = null, justification = "", error = "";
  try {
    const r = await rankResume(
      { title: "Full-Stack Developer (React / Node.js)", description: "B2B SaaS web platform.",
        criteria: ["2+ years web development", "React and TypeScript", "Node.js REST APIs", "PostgreSQL", "Git"] },
      variants[0].aiInput
    );
    score = r.score; justification = r.justification;
  } catch (e) { error = String(e).slice(0, 150); }

  await audit(ctx, "system", "security.bias_test_run", "security", null, { identical, score });
  return NextResponse.json({ variants: variants.map(({ aiInput, ...v }) => ({ ...v, preview: aiInput.split("\n").slice(0, 3).join(" / ") })), identical, score, justification, error });
}
