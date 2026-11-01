import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { draftReply, isCanaryLeak } from "@/lib/ai/gemini";
import { listFollowUps } from "@/lib/followups";
import { rateLimit } from "@/lib/security/ratelimit";
import { formatEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const days = (v: unknown) => Math.min(30, Math.max(0, Math.floor(Number(v ?? 3)) || 0));

// List of candidates who have not answered (computed by plain code on the server)
export async function GET(req: Request) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const wait = days(new URL(req.url).searchParams.get("days") ?? 3);
  try {
    return NextResponse.json({ rows: await listFollowUps(ctx.sb, wait), waitDays: wait });
  } catch {
    return NextResponse.json({ error: "Could not load follow-ups (did you run migration_06?)" }, { status: 500 });
  }
}

const Body = z.object({
  candidateId: z.string().uuid(),
  action: z.enum(["prepare", "replied", "close_no_reply"]),
  days: z.number().int().min(0).max(30).optional(),
});

// "prepare" = the AI drafts a reminder into the approval queue. Nothing is sent here.
// "replied" = the recruiter records that the candidate answered: reminders stop.
// "close_no_reply" = after at least one reminder, the recruiter closes the application as "No reply"
//                    (a rejection with that reason, no email, undoable from the Candidates page).
export async function POST(req: Request) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  if (!rateLimit(`followup:${ctx.user.id}`, 12, 60_000)) return NextResponse.json({ error: "Too many actions, wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { candidateId, action } = parsed.data;

  // re-check eligibility on the server: the browser's list is never trusted
  const [row] = await listFollowUps(ctx.sb, days(parsed.data.days ?? 3), candidateId);
  if (!row) return NextResponse.json({ error: "This candidate is not waiting for an answer" }, { status: 409 });

  if (action === "replied") {
    await ctx.sb.from("candidates").update({ replied_at: new Date().toISOString() }).eq("id", candidateId);
    await audit(ctx, "human", "candidate.replied", "candidates", candidateId, { code: row.code });
    return NextResponse.json({ ok: true });
  }

  if (action === "close_no_reply") {
    if (row.remindersSent < 1) return NextResponse.json({ error: "Send at least one reminder before closing as no reply." }, { status: 409 });
    const { data: c } = await ctx.sb.from("candidates").select("status").eq("id", candidateId).single();
    const now = new Date().toISOString();
    await ctx.sb.from("candidates").update({ status: "rejected", decision_reason: "No reply", decision_note: null, previous_status: c?.status ?? null }).eq("id", candidateId);
    await ctx.sb.from("drafts").update({ status: "discarded", decided_by: ctx.user.id, decided_at: now }).eq("candidate_id", candidateId).eq("status", "pending");
    await ctx.sb.from("calendar_events").delete().eq("candidate_id", candidateId).eq("status", "proposed");
    await audit(ctx, "human", "candidate.reject", "candidates", candidateId, { code: row.code, reason: "No reply", via: "follow-ups", reminders_sent: row.remindersSent, email: "none" });
    return NextResponse.json({ ok: true });
  }

  if (row.state !== "due") {
    const why = { pending_approval: "a reminder is already waiting in the approval queue", max_reached: "the maximum of 2 reminders was reached: call the candidate instead", waiting: "it is too early for a reminder" }[row.state as "pending_approval" | "max_reached" | "waiting"];
    return NextResponse.json({ error: `Not prepared: ${why}.` }, { status: 409 });
  }

  const { data: c } = await ctx.sb.from("candidates").select("anonymized_text,justification,missing_criteria").eq("id", candidateId).single();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // only slots still held in the calendar are offered again (computed by code, never by the AI)
  let slots = row.originalKind === "invite" ? row.originalSlots : [];
  if (slots.length) {
    const { data: holds } = await ctx.sb.from("calendar_events").select("starts_at")
      .eq("draft_id", row.originalId).eq("status", "proposed").gte("starts_at", new Date().toISOString());
    const held = new Set((holds ?? []).map((h) => new Date(h.starts_at).getTime()));
    slots = slots.filter((s) => held.has(new Date(s.start).getTime()));
  }

  try {
    const d = await draftReply("follow_up", { title: row.job }, {
      anonymizedText: c.anonymized_text, justification: c.justification, missing: c.missing_criteria ?? [],
    }, {
      originalKind: row.originalKind, originalSubject: row.originalSubject, daysWaiting: row.daysWaiting,
      reminderNumber: row.remindersSent + 1, hasSlots: slots.length > 0,
    });
    let body = formatEmail(d.body);
    const SLOTS_PH = /\{\{\s*slots\s*\}\}/i;
    if (slots.length) {
      const list = slots.map((s, i) => `  Option ${i + 1}: ${s.label}`).join("\n");
      body = SLOTS_PH.test(body) ? body.replace(SLOTS_PH, list) : `${body}\n\nTime options still available:\n${list}`;
    } else body = body.replace(/\{\{\s*slots\s*\}\}/gi, "");

    const { data: draft, error } = await ctx.sb.from("drafts").insert({
      candidate_id: candidateId, kind: "follow_up", followup_of: row.originalId,
      subject: d.subject, body, created_by: ctx.user.id,
    }).select("id").single();
    if (error) return NextResponse.json({ error: "A reminder is already waiting for approval." }, { status: 409 }); // unique index
    await audit(ctx, "ai", "draft.created", "drafts", draft.id, { code: row.code, kind: "follow_up", reminder: row.remindersSent + 1 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isCanaryLeak(e)) {
      await audit(ctx, "system", "draft.blocked_canary_leak", "candidates", candidateId, { code: row.code });
      return NextResponse.json({ error: "Draft thrown away: the resume made the AI leak its secret instructions. Write this reminder yourself." }, { status: 422 });
    }
    return NextResponse.json({ error: `Draft failed: ${String(e).slice(0, 100)}` }, { status: 502 });
  }
}
