import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, audit, HR } from "@/lib/supabase/server";

const Body = z.object({ eventId: z.string().uuid() });

// Recruiter records the slot the candidate picked: that hold becomes confirmed, the other holds are released.
export async function POST(req: Request) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { data: ev } = await ctx.sb.from("calendar_events").select("*, candidates(code)").eq("id", parsed.data.eventId).single();
  if (!ev || ev.kind !== "interview" || ev.status !== "proposed") return NextResponse.json({ error: "Not a proposed slot" }, { status: 400 });

  await ctx.sb.from("calendar_events").update({ status: "confirmed", title: `Interview: ${ev.candidates?.code}` }).eq("id", ev.id);
  await ctx.sb.from("calendar_events").delete().eq("draft_id", ev.draft_id).eq("status", "proposed");
  await audit(ctx, "human", "interview.confirmed", "calendar_events", ev.id, { code: ev.candidates?.code, starts_at: ev.starts_at });
  return NextResponse.json({ ok: true });
}
