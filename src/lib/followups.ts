import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who needs a reminder? Plain code, no AI (deterministic, not manipulable by a CV).
 * A candidate is waiting when: we SENT them an invite or a request for info (human-approved),
 * they did not answer (no reply recorded, no interview confirmed), and they were not rejected.
 */
export const MAX_REMINDERS = 2;
export const KINDS_NEEDING_ANSWER = ["invite", "request_info"] as const;

export type FollowUpRow = {
  candidateId: string; code: string; name: string | null; job: string;
  originalId: string; originalKind: string; originalSubject: string; originalSlots: { start: string; end: string; label: string }[];
  lastContact: string; daysWaiting: number; remindersSent: number;
  state: "due" | "waiting" | "pending_approval" | "max_reached";
};

type DraftRow = {
  id: string; candidate_id: string; kind: string; subject: string; status: string;
  followup_of: string | null; decided_at: string | null; created_at: string; slots: FollowUpRow["originalSlots"] | null;
};

const DAY = 86400_000;

export async function listFollowUps(sb: SupabaseClient, waitDays: number, onlyCandidate?: string): Promise<FollowUpRow[]> {
  let q = sb.from("drafts").select("id,candidate_id,kind,subject,status,followup_of,decided_at,created_at,slots")
    .in("kind", [...KINDS_NEEDING_ANSWER, "follow_up"]).in("status", ["sent", "pending"]);
  if (onlyCandidate) q = q.eq("candidate_id", onlyCandidate);
  const { data: drafts, error } = await q;
  if (error) throw new Error(error.message);
  const all = (drafts ?? []) as DraftRow[];
  const when = (d: DraftRow) => d.decided_at ?? d.created_at;

  // latest SENT original message per candidate
  const latest = new Map<string, DraftRow>();
  for (const d of all)
    if (d.kind !== "follow_up" && d.status === "sent" && (!latest.has(d.candidate_id) || when(d) > when(latest.get(d.candidate_id)!)))
      latest.set(d.candidate_id, d);
  if (!latest.size) return [];

  const ids = [...latest.keys()];
  const [{ data: cands }, { data: confirmed }] = await Promise.all([
    sb.from("candidates").select("id,code,full_name,status,replied_at,jobs(title)").in("id", ids),
    sb.from("calendar_events").select("candidate_id").in("candidate_id", ids).eq("kind", "interview").eq("status", "confirmed"),
  ]);
  const hasInterview = new Set((confirmed ?? []).map((e) => e.candidate_id));

  const rows: FollowUpRow[] = [];
  for (const c of cands ?? []) {
    const orig = latest.get(c.id)!;
    if (c.status === "rejected" || hasInterview.has(c.id)) continue;
    if (c.replied_at && c.replied_at >= when(orig)) continue;
    const reminders = all.filter((d) => d.followup_of === orig.id);
    const sent = reminders.filter((d) => d.status === "sent");
    const lastContact = [when(orig), ...sent.map(when)].sort().at(-1)!;
    const daysWaiting = Math.floor((Date.now() - new Date(lastContact).getTime()) / DAY);
    const state: FollowUpRow["state"] =
      reminders.some((d) => d.status === "pending") ? "pending_approval"
      : sent.length >= MAX_REMINDERS ? "max_reached"
      : Date.now() - new Date(lastContact).getTime() >= waitDays * DAY ? "due" : "waiting";
    const job = Array.isArray(c.jobs) ? c.jobs[0] : c.jobs;
    rows.push({
      candidateId: c.id, code: c.code, name: c.full_name, job: (job as { title?: string } | null)?.title ?? "",
      originalId: orig.id, originalKind: orig.kind, originalSubject: orig.subject, originalSlots: orig.slots ?? [],
      lastContact, daysWaiting, remindersSent: sent.length, state,
    });
  }
  const order = { due: 0, pending_approval: 1, waiting: 2, max_reached: 3 };
  return rows.sort((a, b) => order[a.state] - order[b.state] || a.lastContact.localeCompare(b.lastContact));
}
