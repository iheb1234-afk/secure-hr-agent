import { NextResponse } from "next/server";
import { requireRole, audit, HR } from "@/lib/supabase/server";
import { draftReply } from "@/lib/ai/gemini";
import { findSlots } from "@/lib/scheduling";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIONS = {
  shortlist: { status: "shortlisted", draft: "invite" },
  reject: { status: "rejected", draft: "rejection" },
  review: { status: "review", draft: "request_info" },
  release: { status: "new", draft: null }, // human reviewed a flagged CV: allow ranking on VISIBLE text only
} as const;

// The HUMAN decides. The AI only prepares a draft, which waits in the approval queue.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(HR);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!rateLimit(`decide:${ctx.user.id}`, 20, 60_000)) return NextResponse.json({ error: "Too many actions, wait a minute." }, { status: 429 });
  const { action } = await req.json().catch(() => ({}));
  if (typeof action !== "string" || !(action in ACTIONS)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const a = ACTIONS[action as keyof typeof ACTIONS];

  const { data: c } = await ctx.sb.from("candidates").select("*, jobs(title)").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // State machine: which decision is allowed from which status
  const ALLOWED: Record<string, string[]> = {
    release: ["flagged"],                       // only a human review can unblock a flagged CV
    reject: ["flagged", "ranked", "review"],    // a flagged CV can be rejected without the AI touching it
    shortlist: ["ranked", "review"],
    review: ["ranked"],
  };
  if (!ALLOWED[action].includes(c.status))
    return NextResponse.json({ error: `Not allowed: candidate is "${c.status}"` }, { status: 409 });

  await ctx.sb.from("candidates").update({ status: a.status }).eq("id", id);
  // one live decision per candidate: older pending drafts are discarded
  await ctx.sb.from("drafts").update({ status: "discarded", decided_by: ctx.user.id, decided_at: new Date().toISOString() })
    .eq("candidate_id", id).eq("status", "pending");
  await audit(ctx, "human", `candidate.${action}`, "candidates", id, { code: c.code });

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
      let body = d.body;
      if (slots.length) {
        const list = slots.map((s, i) => `  Option ${i + 1}: ${s.label}`).join("\n");
        const SLOTS_PH = /\{\{\s*slots\s*\}\}/i;
        body = SLOTS_PH.test(body) ? body.replace(SLOTS_PH, list) : `${body}\n\nProposed slots:\n${list}`;
      } else body = body.replace(/\{\{\s*slots\s*\}\}/gi, "");
      const { data: draft } = await ctx.sb.from("drafts")
        .insert({ candidate_id: id, kind: a.draft, subject: d.subject, body, slots, created_by: ctx.user.id }).select("id").single();
      await audit(ctx, "ai", "draft.created", "drafts", draft?.id ?? null, { code: c.code, kind: a.draft });
    } catch (e) {
      return NextResponse.json({ ok: true, warning: `Decision saved, draft failed: ${String(e).slice(0, 100)}` });
    }
  }
  return NextResponse.json({ ok: true });
}
