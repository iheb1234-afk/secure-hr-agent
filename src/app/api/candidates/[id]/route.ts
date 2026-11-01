import { NextResponse } from "next/server";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { draftReply, isCanaryLeak } from "@/lib/ai/gemini";
import { findSlots } from "@/lib/scheduling";
import { rateLimit } from "@/lib/security/ratelimit";
import { formatEmail } from "@/lib/email";
import { z } from "zod";
import { REJECT_REASONS, NOTE_MIN, needsNote } from "@/lib/decisions";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIONS = {
  shortlist: { status: "shortlisted", draft: "invite" },
  reject: { status: "rejected", draft: "rejection" },
  review: { status: "review", draft: "request_info" },
  release: { status: "new", draft: null }, // human reviewed a flagged CV: allow ranking on VISIBLE text only
  restore: { status: null, draft: null },   // undo a rejection: back to where the candidate was
} as const;

const Body = z.object({
  action: z.enum(["shortlist", "reject", "review", "release", "restore"]),
  reason: z.enum(REJECT_REASONS).optional(),
  note: z.string().trim().max(500).optional(),
});

// The HUMAN decides. The AI only prepares a draft, which waits in the approval queue.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!rateLimit(`decide:${ctx.user.id}`, 20, 60_000)) return NextResponse.json({ error: "Too many actions, wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const { action, note } = parsed.data;
  const a = ACTIONS[action];

  const { data: c } = await ctx.sb.from("candidates").select("*, jobs(title)").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // State machine: which decision is allowed from which status
  const ALLOWED: Record<string, string[]> = {
    release: ["flagged"],                       // only a human review can unblock a flagged CV
    reject: ["flagged", "ranked", "review", "shortlisted"], // a flagged CV can be rejected without the AI touching it
    shortlist: ["ranked", "review"],
    review: ["ranked"],
    restore: ["rejected"],
  };
  if (!ALLOWED[action].includes(c.status))
    return NextResponse.json({ error: `Not allowed: candidate is "${c.status}"` }, { status: 409 });

  // Every rejection has a reason; going against the AI's score needs a written note (logged)
  const reason = action === "reject" ? parsed.data.reason ?? (c.status === "flagged" ? "Manipulation attempt in the resume" : undefined) : undefined;
  if (action === "reject" && !reason) return NextResponse.json({ error: "Pick a reason for the rejection.", needsReason: true }, { status: 422 });
  const noteRule = action === "shortlist" || action === "reject" ? needsNote(action, c.score, reason) : null;
  if (noteRule && (note ?? "").length < NOTE_MIN) return NextResponse.json({ error: noteRule, needsNote: noteRule }, { status: 422 });
  const override = noteRule !== null && reason !== "Other";

  const now = new Date().toISOString();
  // one live decision per candidate: older pending drafts are discarded
  const discardPending = () => ctx.sb.from("drafts").update({ status: "discarded", decided_by: ctx.user.id, decided_at: now })
    .eq("candidate_id", id).eq("status", "pending");

  if (action === "restore") {
    const back = c.previous_status ?? (c.score !== null ? "ranked" : "flagged");
    await ctx.sb.from("candidates").update({ status: back, decision_reason: null, decision_note: null, previous_status: null }).eq("id", id);
    await discardPending();
    const { count } = await ctx.sb.from("drafts").select("id", { count: "exact", head: true })
      .eq("candidate_id", id).eq("kind", "rejection").eq("status", "sent");
    await audit(ctx, "human", "candidate.restore", "candidates", id, { code: c.code, to: back, rejection_already_sent: !!count });
    return NextResponse.json({ ok: true, warning: count
      ? `Rejection undone (back to "${back}"). The rejection email was already sent: contact the candidate yourself.`
      : `Rejection undone (back to "${back}"). The pending rejection email was discarded.` });
  }

  await ctx.sb.from("candidates").update({
    status: a.status,
    ...(action === "reject" ? { decision_reason: reason, decision_note: note || null, previous_status: c.status } : {}),
    ...(action === "shortlist" || action === "review" ? { decision_reason: null, decision_note: note || null, previous_status: null } : {}),
  }).eq("id", id);
  await discardPending();
  // a rejected candidate no longer needs the interview slots held for them
  if (action === "reject") await ctx.sb.from("calendar_events").delete().eq("candidate_id", id).eq("status", "proposed");
  // the note itself stays out of the audit log (free text may contain personal data)
  await audit(ctx, "human", `candidate.${action}`, "candidates", id, {
    code: c.code, ...(reason ? { reason } : {}), has_note: !!note, ai_score: c.score, override_of_ai: override,
  });

  if (a.draft && c.status === "flagged") {
    // a blocked CV never reaches the AI: neutral human-written template
    const { data: draft } = await ctx.sb.from("drafts").insert({
      candidate_id: id, kind: "rejection", created_by: ctx.user.id,
      subject: `Your application: ${c.jobs.title}`,
      body: `Dear {{candidate_name}},\n\nThank you for your interest in the ${c.jobs.title} position. After review, we will not move forward with your application.\n\nWe wish you success in your search.\n\nThe Recruitment Team`,
    }).select("id").single();
    await audit(ctx, "system", "draft.created_from_template", "drafts", draft?.id ?? null, { code: c.code, kind: "rejection" });
  } else if (a.draft) {
    try {
      const d = await draftReply(a.draft, { title: c.jobs.title }, {
        anonymizedText: c.anonymized_text, justification: c.justification, missing: c.missing_criteria ?? [],
      });
      // Interview slots come from the calendar (deterministic), never from the AI
      const slots = a.draft === "invite" ? await findSlots(ctx.sb) : [];
      let body = formatEmail(d.body);
      if (slots.length) {
        const list = slots.map((s, i) => `  Option ${i + 1}: ${s.label}`).join("\n");
        const SLOTS_PH = /\{\{\s*slots\s*\}\}/i;
        body = SLOTS_PH.test(body) ? body.replace(SLOTS_PH, list) : `${body}\n\nProposed slots:\n${list}`;
      } else body = body.replace(/\{\{\s*slots\s*\}\}/gi, "");
      const { data: draft } = await ctx.sb.from("drafts")
        .insert({ candidate_id: id, kind: a.draft, subject: d.subject, body, slots, created_by: ctx.user.id }).select("id").single();
      await audit(ctx, "ai", "draft.created", "drafts", draft?.id ?? null, { code: c.code, kind: a.draft });
    } catch (e) {
      if (isCanaryLeak(e)) {
        await audit(ctx, "system", "draft.blocked_canary_leak", "candidates", id, { code: c.code });
        return NextResponse.json({ ok: true, warning: "Decision saved. The AI draft was thrown away: the resume made the model leak its secret instructions. Write this email yourself." });
      }
      return NextResponse.json({ ok: true, warning: `Decision saved, draft failed: ${String(e).slice(0, 100)}` });
    }
  }
  return NextResponse.json({ ok: true });
}
