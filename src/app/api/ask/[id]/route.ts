import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, audit } from "@/lib/supabase/server";

const Body = z.object({ answer: z.string().trim().min(2).max(2000) });

// HR answers an escalated question (a human, not the AI)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["recruiter", "admin"].includes(ctx.role)) return NextResponse.json({ error: "HR only" }, { status: 403 });
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  const { error } = await ctx.sb.from("employee_questions")
    .update({ answer: parsed.data.answer, status: "answered", reason: "Answered by HR (human)" }).eq("id", id).eq("status", "escalated");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await audit(ctx, "human", "question.answered_by_hr", "employee_questions", id, {});
  return NextResponse.json({ ok: true });
}
