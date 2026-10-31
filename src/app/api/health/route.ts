import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireUser } from "@/lib/supabase/server";

// Logged-in only: quick check that the AI key + model work (no retries)
export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const t = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const r = await ai.models.generateContent({ model, contents: "Reply with the word OK." });
    return NextResponse.json({ ok: true, model, ms: Date.now() - t, reply: r.text?.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ ok: false, model, ms: Date.now() - t, error: String(e).slice(0, 400) });
  }
}
