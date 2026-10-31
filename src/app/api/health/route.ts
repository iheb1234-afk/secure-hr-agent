import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireRole } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/ratelimit";

// Logged-in only: quick check that the AI key + model work (no retries)
export async function GET(req: Request) {
  const ctx = await requireRole(["admin"]);
  if (ctx instanceof Response) return ctx;
  if (!rateLimit(`health:${ctx.user.id}`, 5, 60_000)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const q = new URL(req.url).searchParams.get("model");
  const model = q && /^[\w.-]{3,40}$/.test(q) ? q : process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const t = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const r = await ai.models.generateContent({ model, contents: "Reply with the word OK." });
    return NextResponse.json({ ok: true, model, ms: Date.now() - t, reply: r.text?.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ ok: false, model, ms: Date.now() - t, error: String(e).slice(0, 400) });
  }
}
