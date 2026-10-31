import { NextResponse } from "next/server";
import { requireUser, audit } from "@/lib/supabase/server";
import { extractPdf } from "@/lib/security/pdf";
import { scanRules } from "@/lib/security/injection";
import { anonymize } from "@/lib/security/anonymize";
import { classifyInjection } from "@/lib/ai/gemini";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILES = 30;
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`upload:${ctx.user.id}`, 10, 60_000))
    return NextResponse.json({ error: "Too many uploads, wait a minute." }, { status: 429 });

  const form = await req.formData();
  const jobId = String(form.get("jobId") || "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  if (!files.length || files.length > MAX_FILES)
    return NextResponse.json({ error: `Upload 1 to ${MAX_FILES} files` }, { status: 400 });

  const { count } = await ctx.sb.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  let n = count ?? 0;
  const results: { file: string; ok: boolean; flagged?: boolean; error?: string; note?: string }[] = [];

  for (const file of files) {
    const name = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 100);
    try {
      if (file.size > MAX_SIZE) throw new Error("File larger than 2 MB");
      const buf = new Uint8Array(await file.arrayBuffer());
      const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF magic bytes
      const isTxt = name.toLowerCase().endsWith(".txt") && !buf.slice(0, 1000).includes(0);
      if (!isPdf && !isTxt) throw new Error("Only real PDF or TXT files are accepted");

      let visible = "", hidden = "", hiddenReasons: string[] = [];
      if (isPdf) {
        const r = await extractPdf(buf);
        visible = r.visibleText; hidden = r.hiddenText; hiddenReasons = r.hiddenReasons;
      } else visible = new TextDecoder().decode(buf);
      if (visible.length < 50) throw new Error("No readable text in file");

      // Layer 1 rules (on everything), Layer 2 LLM classifier, Layer 3 hidden text
      const rules = scanRules(`${visible}\n${hidden}`);
      const reasons: string[] = [...hiddenReasons.map((r) => `Hidden text: ${r}`), ...rules.reasons];
      let classifierNote: string | null = null;
      if (!reasons.length) {
        // only spend an AI call if the cheap layers found nothing (saves free-tier quota)
        try {
          await new Promise((r) => setTimeout(r, 4200)); // free tier = 15 calls/min
          const llm = await classifyInjection(`${visible}\n${hidden}`);
          if (llm.is_injection) reasons.push(`AI security filter: ${llm.reason}`);
        } catch (e) {
          // rules + hidden-text layers already passed, and ranking prompts are still guarded: log, don't block
          classifierNote = `AI classifier skipped: ${String(e).slice(0, 150)}`;
        }
      }
      const flagged = reasons.length > 0;

      // The AI only ever sees VISIBLE text, with personal data removed
      const anon = anonymize(visible);
      n += 1;
      const { data, error } = await ctx.sb
        .from("candidates")
        .insert({
          job_id: jobId,
          code: `C-${String(n).padStart(2, "0")}`,
          file_name: name,
          full_name: anon.fullName,
          email: anon.email,
          visible_text: visible,
          anonymized_text: anon.text,
          hidden_text: hidden || null,
          injection_flag: flagged,
          injection_reasons: reasons,
          status: flagged ? "flagged" : "new",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await audit(ctx, "system", flagged ? "resume.flagged_injection" : "resume.ingested", "candidates", data.id, {
        file: name, reasons, removed_pii: anon.removed, hidden_chars: hidden.length, classifierNote,
      });
      results.push({ file: name, ok: true, flagged, note: classifierNote ?? undefined });
    } catch (e) {
      results.push({ file: name, ok: false, error: e instanceof Error ? e.message : "Error" });
    }
  }
  return NextResponse.json({ results });
}
