import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";

const Body = z.object({ answer: z.string().trim().min(2).max(2000) });

// HR answers an escalated question (a human, not the AI)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const { data: updated, error } = await ctx.sb.from("employee_questions")
    .update({ answer: parsed.data.answer, status: "answered", reason: "Answered by HR (human)" }).eq("id", id).eq("status", "escalated").select("id");
  if (error || !updated?.length) return NextResponse.json({ error: "Question not waiting for HR" }, { status: 400 });
  await audit(ctx, "human", "question.answered_by_hr", "employee_questions", id, {});
  return NextResponse.json({ ok: true });
}
