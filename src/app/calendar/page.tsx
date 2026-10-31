"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Ev = { id: string; title: string; starts_at: string; ends_at: string; kind: string; status: string; draft_id: string | null };

const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Tunis" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "Africa/Tunis" });

export default function Calendar() {
  const sb = supabaseBrowser();
  const [events, setEvents] = useState<Ev[]>([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.from("calendar_events").select("*").gte("ends_at", new Date().toISOString()).order("starts_at");
    setEvents(data ?? []);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function confirm(id: string) {
    setBusy(id);
    await fetch("/api/interviews/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: id }) });
    setBusy(""); load();
  }

  const days = events.reduce<Record<string, Ev[]>>((acc, e) => { (acc[dayKey(e.starts_at)] ||= []).push(e); return acc; }, {});
  const style = (e: Ev) =>
    e.kind === "busy" ? "border-slate-200 bg-slate-100 text-slate-500"
      : e.status === "proposed" ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-green-300 bg-green-50 text-green-800";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Recruiter calendar (next week)</h1>
        <p className="text-sm text-slate-500">
          Interview slots are computed from this calendar, not by the AI. Approved invites place <span className="text-amber-700">holds</span>; when the candidate answers, the recruiter confirms the slot they picked and the other holds are released.
        </p>
      </div>
      <div className="flex gap-3 text-xs">
        <span className="rounded border border-slate-200 bg-slate-100 px-2">Busy</span>
        <span className="rounded border border-amber-300 bg-amber-50 px-2">Proposed hold</span>
        <span className="rounded border border-green-300 bg-green-50 px-2">Confirmed interview</span>
      </div>
      {!events.length && <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">No events. Run supabase/migration_02_scheduling.sql to load the demo calendar.</p>}
      <div className="grid gap-3 md:grid-cols-5">
        {Object.entries(days).map(([day, evs]) => (
          <div key={day} className="rounded-xl border bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold">{day}</h2>
            <div className="space-y-2">
              {evs.map((e) => (
                <div key={e.id} className={`rounded border p-2 text-xs ${style(e)}`}>
                  <b>{fmt(e.starts_at)}–{fmt(e.ends_at)}</b>
                  <div>{e.title}</div>
                  {e.kind === "interview" && e.status === "proposed" && (
                    <button onClick={() => confirm(e.id)} disabled={!!busy} className="mt-1 rounded bg-green-600 px-2 py-0.5 text-white">
                      Candidate picked this ✓
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
