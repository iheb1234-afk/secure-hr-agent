import { NextResponse } from "next/server";
import { requireUser, audit } from "@/lib/supabase/server";
import { scanRules } from "@/lib/security/injection";
import { summarizeInbox } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Builds the daily digest. Emails are untrusted input: they go through the same injection shield as CVs.
export async function POST() {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`digest:${ctx.user.id}`, 3, 60_000)) return NextResponse.json({ error: "Wait a minute." }, { status: 429 });

  const { data: emails } = await ctx.sb.from("inbox_emails").select("*").order("received_at", { ascending: false }).limit(50);
  if (!emails?.length) return NextResponse.json({ error: "Inbox is empty. Run supabase/migration_03_inbox.sql." }, { status: 400 });

  const clean: { ref: string; id: string; from: string; subject: string; body: string }[] = [];
  let blocked = 0;
  for (const [i, e] of emails.entries()) {
    const r = scanRules(`${e.subject}\n${e.body}`);
    if (r.flagged) {
      blocked++;
      await ctx.sb.from("inbox_emails").update({
        flagged: true, flag_reasons: r.reasons, category: "other", urgency: "low", needs_human: true,
        summary: "Blocked: this email tries to give instructions to the AI. Review it manually.", processed_at: new Date().toISOString(),
      }).eq("id", e.id);
      await audit(ctx, "system", "email.flagged_injection", "inbox_emails", e.id, { reasons: r.reasons });
    } else {
      // only the sender name goes to the AI, not the address
      clean.push({ ref: `E${i + 1}`, id: e.id, from: e.from_name, subject: e.subject, body: e.body });
    }
  }

  try {
    const res = await summarizeInbox(clean);
    const byRef = new Map(clean.map((c) => [c.ref, c.id]));
    let done = 0;
    for (const it of res.items) {
      const id = byRef.get(it.ref);
      if (!id) continue; // ignore anything the AI invented
      await ctx.sb.from("inbox_emails").update({
        category: it.category, urgency: it.urgency, needs_human: it.needs_human, summary: it.summary,
        flagged: false, flag_reasons: [], processed_at: new Date().toISOString(),
      }).eq("id", id);
      done++;
    }
    await audit(ctx, "ai", "inbox.digest_created", "inbox_emails", null, { emails: emails.length, classified: done, blocked });
    return NextResponse.json({ classified: done, blocked, total: emails.length });
  } catch (e) {
    return NextResponse.json({ error: `AI error: ${String(e).slice(0, 150)}`, blocked }, { status: 502 });
  }
}
