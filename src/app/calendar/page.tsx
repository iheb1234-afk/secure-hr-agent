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
    e.kind === "busy" ? "border-l-ink-3/40 bg-wash text-ink-2"
      : e.status === "proposed" ? "border-l-ai bg-ai-soft text-ai outline-1 outline-dashed outline-ai/40 -outline-offset-1"
      : "border-l-human bg-human-soft text-human";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="page-title">Interviews next week</h1>
        <p className="page-lede">
          Free slots are computed from this calendar by plain code, not by the AI, so it can&apos;t invent a time. An approved invite places holds; when the candidate answers, you confirm the slot they picked and the other holds are released.
        </p>
      </header>
      <div className="flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm border-l-2 border-l-ink-3/40 bg-wash" />Busy</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm border-l-2 border-l-ai bg-ai-soft outline-1 outline-dashed outline-ai/40" />Hold, waiting for the candidate</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm border-l-2 border-l-human bg-human-soft" />Confirmed by you</span>
      </div>
      {!events.length && <p className="panel px-5 py-10 text-center text-sm text-ink-2">No events. Run supabase/migration_02_scheduling.sql to load the demo calendar.</p>}
      <div className="grid gap-px overflow-hidden rounded-[10px] border bg-line md:grid-cols-5">
        {Object.entries(days).map(([day, evs]) => (
          <div key={day} className="bg-white p-3">
            <h2 className="mb-3 text-sm font-semibold">{day}</h2>
            <div className="space-y-2">
              {evs.map((e) => (
                <div key={e.id} className={`rounded-md border-l-[3px] px-2.5 py-2 text-xs ${style(e)}`}>
                  <div className="font-semibold tabular-nums">{fmt(e.starts_at)}–{fmt(e.ends_at)}</div>
                  <div className="mt-0.5">{e.title}</div>
                  {e.kind === "interview" && e.status === "proposed" && (
                    <button onClick={() => confirm(e.id)} disabled={!!busy} className="btn btn-sm btn-approve mt-2 w-full">
                      Candidate picked this
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
