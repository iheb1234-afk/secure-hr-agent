import type { Metadata } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { requireUser } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Nav, { type Group } from "./nav";

export const metadata: Metadata = { title: "HireGuard — Secure AI HR Agent", description: "The agent executes, the human decides." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  // employees only get the Q&A page (data is also protected by Row Level Security)
  const path = (await headers()).get("x-pathname") ?? "";
  if (ctx?.role === "employee" && !path.startsWith("/ask") && !path.startsWith("/login")) redirect("/ask");

  let groups: Group[] = [];
  if (ctx) {
    const isHR = ctx.role !== "employee";
    // live counters: what is waiting for a human (read-only, filtered by Row Level Security)
    const count = async (table: string, status: string) => {
      if (!isHR) return 0;
      const { count } = await ctx.sb.from(table).select("id", { count: "exact", head: true }).eq("status", status);
      return count ?? 0;
    };
    const [pending, flagged, escalated] = await Promise.all([
      count("drafts", "pending"), count("candidates", "flagged"), count("employee_questions", "escalated"),
    ]);
    groups = isHR ? [
      { title: "Hiring", items: [
        { href: "/", label: "Candidates", icon: "people", count: flagged, tone: "block" },
        { href: "/approvals", label: "Approval queue", icon: "gate", count: pending, tone: "ai" },
        { href: "/followups", label: "Follow-ups", icon: "bell" },
        { href: "/calendar", label: "Interviews", icon: "calendar" },
      ] },
      { title: "HR desk", items: [
        { href: "/inbox", label: "Inbox digest", icon: "inbox" },
        { href: "/ask", label: "Employee questions", icon: "ask", count: escalated, tone: "ai" },
      ] },
      { title: "Trust", items: [
        { href: "/security", label: "Security Lab", icon: "shield" },
        ...(ctx.role === "admin" ? [{ href: "/audit", label: "Audit log", icon: "log" as const }] : []),
      ] },
    ] : [{ title: "Help", items: [{ href: "/ask", label: "Ask HR", icon: "ask" }] }];
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {ctx && <Nav groups={groups} email={ctx.user.email ?? ""} role={ctx.role} />}
        <main className={ctx ? "md:pl-60" : ""}>
          <div className="mx-auto max-w-[1080px] px-4 py-6 md:px-10 md:py-9">{children}</div>
        </main>
      </body>
    </html>
  );
}
