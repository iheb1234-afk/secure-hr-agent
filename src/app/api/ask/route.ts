import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, audit } from "@/lib/supabase/server";
import { scanRules } from "@/lib/security/injection";
import { searchPolicies, sensitiveTopic } from "@/lib/policy-search";
import { answerFromPolicies } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(5).max(500) });

// Employee asks → (1) injection shield → (2) sensitive topic? straight to a human → (3) find policy sections
// → (4) AI answers ONLY from them, with citations → (5) no answer in the policies? escalate to HR. Every question is logged.
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`ask:${ctx.user.id}`, 8, 60_000)) return NextResponse.json({ error: "Too many questions, wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Question must be 5 to 500 characters." }, { status: 400 });
  const question = parsed.data.question;

  const save = async (row: { answer: string | null; sources: unknown[]; status: string; reason: string | null }) => {
    const { data } = await ctx.sb.from("employee_questions").insert({ question, ...row }).select("id").single();
    await audit(ctx, row.status === "answered" ? "ai" : "system", `question.${row.status}`, "employee_questions", data?.id ?? null, { reason: row.reason, sources: row.sources.length });
    return NextResponse.json({ status: row.status, answer: row.answer, sources: row.sources, reason: row.reason });
  };

  const rules = scanRules(question);
  if (rules.flagged)
    return save({ answer: null, sources: [], status: "blocked", reason: `Manipulation attempt: ${rules.reasons.join(", ")}` });

  const sensitive = sensitiveTopic(question);
  if (sensitive)
    return save({ answer: "This topic is handled personally by HR. Your question has been forwarded and someone will contact you confidentially.", sources: [], status: "escalated", reason: sensitive });

  const { data: sections } = await ctx.sb.from("policy_sections").select("id,doc,section,content");
  const hits = searchPolicies(question, sections ?? []);
  const excerpts = hits.map((h, i) => ({ ref: `P${i + 1}`, id: h.id, title: `${h.doc}: ${h.section}`, content: h.content }));

  try {
    const r = await answerFromPolicies(question, excerpts);
    const cited = excerpts.filter((e) => r.cited.includes(e.ref)); // ignore any reference the AI invented
    if (!r.answerable || !cited.length)
      return save({ answer: "I couldn't find this in the company policies, so I won't guess. Your question has been forwarded to HR.", sources: [], status: "escalated", reason: "Not covered by the policy documents" });
    return save({
      answer: r.answer.replace(/\[P\d\]/g, "").trim(),
      sources: cited.map((c) => ({ title: c.title, excerpt: c.content })),
      status: "answered", reason: null,
    });
  } catch (e) {
    return save({ answer: "The assistant is unavailable, your question was forwarded to HR.", sources: [], status: "escalated", reason: `AI error: ${String(e).slice(0, 100)}` });
  }
}
