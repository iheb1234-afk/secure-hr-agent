import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, audit } from "@/lib/supabase/server";

const Body = z.object({
  action: z.enum(["approve", "discard"]),
  subject: z.string().min(1).max(150).optional(),
  body: z.string().min(1).max(3000).optional(),
});

// Nothing leaves the system without a human click. "Send" = simulated outbox in this prototype.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, subject, body } = parsed.data;

  const { data: d } = await ctx.sb.from("drafts").select("*, candidates(code, full_name, email)").eq("id", id).single();
  if (!d || d.status !== "pending") return NextResponse.json({ error: "Draft not pending" }, { status: 400 });

  if (action === "discard") {
    await ctx.sb.from("drafts").update({ status: "discarded", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", id);
    await audit(ctx, "human", "draft.discarded", "drafts", id, { code: d.candidates.code });
    return NextResponse.json({ ok: true });
  }

  const edited = (subject && subject !== d.subject) || (body && body !== d.body);
  const name = d.candidates.full_name ?? "Candidate";
  const finalBody = (body ?? d.body).replaceAll("{{candidate_name}}", name);
  const finalSubject = (subject ?? d.subject).replaceAll("{{candidate_name}}", name);

  await ctx.sb.from("drafts").update({
    status: "sent", subject: finalSubject, body: finalBody, decided_by: ctx.user.id, decided_at: new Date().toISOString(),
  }).eq("id", id);
  await audit(ctx, "human", "draft.approved_and_sent", "drafts", id, {
    code: d.candidates.code, edited_by_human: !!edited, to: d.candidates.email ? "[candidate email]" : null,
  });
  return NextResponse.json({ ok: true });
}
