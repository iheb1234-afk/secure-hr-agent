import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { scanRules, unicodeCheck } from "@/lib/security/injection";
import { classifyInjection } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ text: z.string().min(3).max(2000) });

// Attack playground: runs typed text through the SAME detection layers as a real upload.
// Nothing is stored or ranked; only an audit entry (without the text) is written.
export async function POST(req: Request) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  if (!rateLimit(`playground:${ctx.user.id}`, 6, 60_000)) return NextResponse.json({ error: "Too many tests. Wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Type between 3 and 2000 characters." }, { status: 400 });
  const { text } = parsed.data;

  const unicode = unicodeCheck(text).reasons;
  const rules = scanRules(text).reasons.filter((r) => !unicode.includes(r));

  // Layer 4 always runs here so the jury sees every layer's verdict
  let ai: { caught: boolean; reason: string; unavailable?: boolean };
  try {
    const r = await classifyInjection(text);
    ai = { caught: r.is_injection, reason: r.reason };
  } catch {
    ai = { caught: true, unavailable: true, reason: "AI check unavailable: fails closed, a real upload would be held for a human." };
  }

  const blocked = unicode.length > 0 || rules.length > 0 || ai.caught;
  await audit(ctx, "system", blocked ? "security.playground_blocked" : "security.playground_allowed", "security", null, {
    length: text.length, unicode: unicode.length, rules: rules.length, ai: ai.caught,
  });
  return NextResponse.json({ blocked, unicode, rules, ai });
}
