"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Mark } from "../nav";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setErr("Wrong email or password.");
    else window.location.href = "/";
  }

  return (
    <div className="mx-auto mt-[12vh] max-w-sm">
      <div className="flex items-center gap-3">
        <Mark className="h-10 w-10" />
        <div>
          <h1 className="text-2xl font-semibold leading-tight">HireGuard</h1>
          <p className="text-sm text-ink-2">The agent executes, the human decides.</p>
        </div>
      </div>
      <form onSubmit={submit} className="panel mt-8 space-y-4 p-6">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Work email</span>
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <p role="alert" className="rounded-md bg-block-soft px-3 py-2 text-sm text-block">{err}</p>}
        <button disabled={loading} className="btn btn-primary w-full py-2.5">{loading ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-4 text-center text-xs text-ink-3">Accounts are created by an admin. There is no public sign-up.</p>
    </div>
  );
}
