import type { Metadata } from "next";
import "./globals.css";
import { requireUser } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata: Metadata = { title: "HireGuard — Secure AI HR Agent", description: "The agent executes, the human decides." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {ctx && (
          <header className="border-b bg-white">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <span className="font-bold text-indigo-700">🛡️ HireGuard</span>
              <nav className="flex gap-4 text-sm">
                <Link href="/" className="hover:text-indigo-700">Candidates</Link>
                <Link href="/approvals" className="hover:text-indigo-700">Approval queue</Link>
                <Link href="/calendar" className="hover:text-indigo-700">Calendar</Link>
                {ctx.role === "admin" && <Link href="/audit" className="hover:text-indigo-700">Audit log</Link>}
              </nav>
              <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                <span>{ctx.user.email} · <b className="uppercase">{ctx.role}</b></span>
                <form action="/api/logout" method="post"><button className="rounded border px-2 py-1 hover:bg-slate-100">Log out</button></form>
              </div>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
