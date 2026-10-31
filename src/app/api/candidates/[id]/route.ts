import { NextResponse } from "next/server";
import { requireUser, audit } from "@/lib/supabase/server";
import { draftReply } from "@/lib/ai/gemini";
import { findSlots } from "@/lib/scheduling";

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
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  if (!(action in ACTIONS)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const a = ACTIONS[action as keyof typeof ACTIONS];

  const { data: c } = await ctx.sb.from("candidates").select("*, jobs(title)").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (action === "release" && c.status !== "flagged") return NextResponse.json({ error: "Not flagged" }, { status: 400 });

  await ctx.sb.from("candidates").update({ status: a.status }).eq("id", id);
  await audit(ctx, "human", `candidate.${action}`, "candidates", id, { code: c.code });

  if (a.draft) {
    try {
      const d = await draftReply(a.draft, { title: c.jobs.title }, {
        anonymizedText: c.anonymized_text, justification: c.justification, missing: c.missing_criteria ?? [],
      });
      // Interview slots come from the calendar (deterministic), never from the AI
      const slots = a.draft === "invite" ? await findSlots(ctx.sb) : [];
      let body = d.body;
      if (slots.length) {
        const list = slots.map((s, i) => `  Option ${i + 1}: ${s.label}`).join("\n");
        body = body.includes("{{slots}}") ? body.replace("{{slots}}", list) : `${body}\n\nProposed slots:\n${list}`;
      } else body = body.replace("{{slots}}", "");
      const { data: draft } = await ctx.sb.from("drafts")
        .insert({ candidate_id: id, kind: a.draft, subject: d.subject, body, slots }).select("id").single();
      await audit(ctx, "ai", "draft.created", "drafts", draft?.id ?? null, { code: c.code, kind: a.draft });
    } catch (e) {
      return NextResponse.json({ ok: true, warning: `Decision saved, draft failed: ${String(e).slice(0, 100)}` });
    }
  }
  return NextResponse.json({ ok: true });
}
