"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: keyof typeof ICONS; count?: number; tone?: "ai" | "block" };
export type Group = { title: string; items: Item[] };

const ICONS = {
  people: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15 4.6a3 3 0 0 1 0 5.8",
  gate: "M5 20V5M19 20V5M5 9h14M9 9v11M15 9v11",
  inbox: "M4 13h4l1.5 3h5L16 13h4M5.5 5h13L20 13v6H4v-6l1.5-8Z",
  ask: "M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-3 2.5ZM9.5 8.5a2.5 2.5 0 1 1 3.2 2.4c-.4.12-.7.5-.7.9V12.5M12 14.5v.01",
  calendar: "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4",
  shield: "M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5ZM9 12l2 2 4-4",
  log: "M7 4h10v16H7zM10 8h4M10 12h4M10 16h2",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  // a gate: the AI's work stops here until a human opens it
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#17694f" />
      <path d="M9 24V9M23 24V9M9 13h14M13.5 13v11M18.5 13v11" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function Nav({ groups, email, role }: { groups: Group[]; email: string; role: string }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const all = groups.flatMap((g) => g.items);

  return (
    <>
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-ink text-white/80 md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-5">
          <Mark />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-white">HireGuard</div>
            <div className="text-[11px] text-white/50">The agent executes, the human decides</div>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-2 pb-1.5 text-[11px] font-medium text-white/40">{g.title}</div>
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} aria-current={active(it.href) ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-[7px] text-sm transition-colors ${active(it.href) ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"}`}>
                  <Icon name={it.icon} />
                  <span className="flex-1">{it.label}</span>
                  {!!it.count && (
                    <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${it.tone === "block" ? "bg-block text-white" : "bg-[#f2c879] text-ink"}`}>{it.count}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs">
          <div className="truncate text-white/80" title={email}>{email}</div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="capitalize text-white/45">{role}</span>
            <form action="/api/logout" method="post"><button className="text-white/60 underline-offset-2 hover:text-white hover:underline">Log out</button></form>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-20 border-b bg-ink text-white md:hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <Mark className="h-6 w-6" />
          <span className="font-semibold">HireGuard</span>
          <form action="/api/logout" method="post" className="ml-auto"><button className="text-xs text-white/60">Log out</button></form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-sm">
          {all.map((it) => (
            <Link key={it.href} href={it.href} className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 ${active(it.href) ? "bg-white/15 text-white" : "text-white/70"}`}>
              {it.label}
              {!!it.count && <span className={`rounded-full px-1.5 text-[11px] font-semibold ${it.tone === "block" ? "bg-block" : "bg-[#f2c879] text-ink"}`}>{it.count}</span>}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
