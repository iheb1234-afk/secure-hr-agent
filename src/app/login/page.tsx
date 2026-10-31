"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

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
    if (error) setErr("Invalid credentials");
    else window.location.href = "/";
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold text-indigo-700">🛡️ HireGuard</h1>
      <p className="mb-6 text-sm text-slate-500">Secure AI HR agent. The agent executes, the human decides.</p>
      <form onSubmit={submit} className="space-y-3">
        <input className="w-full rounded border px-3 py-2" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded border px-3 py-2" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={loading} className="w-full rounded bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
