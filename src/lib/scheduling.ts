import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deterministic slot finder (no AI involved → reliable and not manipulable).
 * Looks at the recruiter's calendar next week and returns 3 free 45-minute slots on different days.
 */
export type Slot = { start: string; end: string; label: string };

const TZ_OFFSET_H = 1; // Africa/Tunis = UTC+1, no DST
const HOURS = [9, 10, 11, 14, 15, 16];
const DURATION_MIN = 45;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function nextMondayUTC(now = new Date()): Date {
  const local = new Date(now.getTime() + TZ_OFFSET_H * 3600_000);
  const dow = local.getUTCDay(); // 0 = Sunday
  const add = ((8 - dow) % 7) || 7;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, -TZ_OFFSET_H));
}

export function labelOf(start: Date, end: Date) {
  const l = new Date(start.getTime() + TZ_OFFSET_H * 3600_000);
  const e = new Date(end.getTime() + TZ_OFFSET_H * 3600_000);
  const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const dayName = ["Sunday", ...DAYS, "Saturday"][l.getUTCDay()];
  return `${dayName} ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]}, ${hm(l)}–${hm(e)} (Tunis time)`;
}

export async function findSlots(sb: SupabaseClient, count = 3): Promise<Slot[]> {
  const monday = nextMondayUTC();
  const friday = new Date(monday.getTime() + 5 * 86400_000);
  const { data: events } = await sb
    .from("calendar_events").select("starts_at,ends_at")
    .lt("starts_at", friday.toISOString()).gt("ends_at", monday.toISOString());
  const busy = (events ?? []).map((e) => [new Date(e.starts_at).getTime(), new Date(e.ends_at).getTime()]);
  const free = (s: number, e: number) => !busy.some(([bs, be]) => s < be && e > bs);

  const perDay: Slot[][] = DAYS.map((_, d) =>
    HOURS.flatMap((h) => {
      const s = monday.getTime() + d * 86400_000 + h * 3600_000;
      const e = s + DURATION_MIN * 60_000;
      return free(s, e) ? [{ start: new Date(s).toISOString(), end: new Date(e).toISOString(), label: labelOf(new Date(s), new Date(e)) }] : [];
    })
  );
  // spread over different days: Mon, Wed, Fri first, then the others
  const out: Slot[] = [];
  for (const d of [0, 2, 4, 1, 3]) if (perDay[d][0] && out.length < count) out.push(perDay[d][0]);
  for (const d of [0, 1, 2, 3, 4]) for (const s of perDay[d].slice(1)) if (out.length < count) out.push(s);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
