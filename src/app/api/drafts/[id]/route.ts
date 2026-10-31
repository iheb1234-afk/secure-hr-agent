import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { withNotice } from "@/lib/email";

const Body = z.object({
  action: z.enum(["approve", "discard"]),
  subject: z.string().min(1).max(150).optional(),
  body: z.string().min(1).max(3000).optional(),
});

// Nothing leaves the system without a human click. "Send" = simulated outbox in this prototype.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, subject, body } = parsed.data;

  const { data: d } = await ctx.sb.from("drafts").select("*, candidates(code, full_name, email)").eq("id", id).single();
  if (!d || d.status !== "pending") return NextResponse.json({ error: "Draft not pending" }, { status: 400 });

  if (action === "discard") {
    await ctx.sb.from("drafts").update({ status: "discarded", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    await audit(ctx, "human", "draft.discarded", "drafts", id, { code: d.candidates.code });
    return NextResponse.json({ ok: true });
  }

  const edited = (subject && subject !== d.subject) || (body && body !== d.body);
  const name = d.candidates.full_name ?? "Candidate";
  // Tolerant matching: the AI sometimes alters the placeholder ({{ Candidate_Name }}, {{candidate name}}…)
  const NAME_PH = /\{\{\s*candidate[\s_-]*name\s*\}\}|\[\s*candidate[\s_-]*name\s*\]/gi;
  const finalBody = (body ?? d.body).replace(NAME_PH, name);
  const finalSubject = (subject ?? d.subject).replace(NAME_PH, name);

  // Output check: never send an email that still contains a placeholder
  const leftover = `${finalSubject}\n${finalBody}`.match(/\{\{[^}]*\}\}|\[(?:CANDIDATE|EMAIL|PHONE|ADDRESS|LINK|REMOVED)\]/);
  if (leftover) {
    await audit(ctx, "system", "draft.send_blocked_placeholder", "drafts", id, { code: d.candidates.code, placeholder: leftover[0] });
    return NextResponse.json({ error: `Not sent: the email still contains "${leftover[0]}". Edit it, then approve again.` }, { status: 422 });
  }

  // only flips a draft that is STILL pending (two clicks at once can't send it twice)
  const { data: updated, error: upErr } = await ctx.sb.from("drafts").update({
    status: "sent", subject: finalSubject, body: withNotice(finalBody), // AI-screening notice added by the server, not editable decided_by: ctx.user.id, decided_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "pending").select("id");
  if (upErr || !updated?.length) return NextResponse.json({ error: "Draft was already handled" }, { status: 409 });
  // Approved invite → hold the proposed slots in the recruiter's calendar until the candidate picks one
  if (d.kind === "invite" && Array.isArray(d.slots) && d.slots.length) {
    await ctx.sb.from("calendar_events").insert(
      d.slots.map((s: { start: string; end: string }) => ({
        title: `Interview hold: ${d.candidates.code}`, starts_at: s.start, ends_at: s.end,
        kind: "interview", status: "proposed", candidate_id: d.candidate_id, draft_id: id,
      }))
    );
  }
  await audit(ctx, "human", "draft.approved_and_sent", "drafts", id, {
    code: d.candidates.code, edited_by_human: !!edited, to: d.candidates.email ? "[candidate email]" : null,
  });
  return NextResponse.json({ ok: true });
}
