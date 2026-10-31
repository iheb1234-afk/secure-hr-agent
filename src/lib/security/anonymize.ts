/**
 * Anti-bias + privacy: remove personal data BEFORE the resume reaches the AI.
 * The AI ranks on skills and experience only. Name/email are kept in the DB for the
 * human-approved reply, but never sent to the model.
 */
export type Anonymized = { text: string; fullName: string | null; email: string | null; removed: string[] };

const LINE_FIELDS = /^\s*(name|full name|nom|address|adresse|date of birth|birth ?date|dob|né\(e\)? le|nationality|nationalité|marital status|situation familiale|photo|religion)\s*:.*$/gim;
const INLINE_FIELDS = /\b(age|âge|gender|sexe|sex|marital status|situation familiale)\s*:\s*[^|\n]+/gi;

export function anonymize(text: string): Anonymized {
  const removed = new Set<string>();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // By convention the first line of a CV is the candidate's name
  const fullName = lines[0] && lines[0].split(/\s+/).length <= 5 && !/[@\d]/.test(lines[0]) ? lines[0] : null;
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0] : null;

  let t = text;
  if (fullName) {
    t = t.split(fullName).join("[CANDIDATE]");
    for (const part of fullName.split(/\s+/)) if (part.length > 2) t = t.replace(new RegExp(`\\b${part}\\b`, "g"), "[CANDIDATE]");
    removed.add("name");
  }
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) removed.add("email");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]");
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(t)) removed.add("phone");
  t = t.replace(/(\+?\d[\d\s().-]{7,}\d)/g, "[PHONE]");
  t = t.replace(/https?:\/\/\S+|www\.\S+|linkedin\.com\/\S+/gi, "[LINK]");
  t = t.replace(LINE_FIELDS, (m) => { removed.add(m.split(":")[0].trim().toLowerCase()); return "[REMOVED]"; });
  t = t.replace(INLINE_FIELDS, (m) => { removed.add(m.split(":")[0].trim().toLowerCase()); return "[REMOVED]"; });
  t = t.replace(/\b(Mr|Mrs|Ms|Miss|Mme|Mlle|M)\.\s/g, "");
  t = t.replace(/\b(\d{1,3}\s+)?(rue|avenue|av\.|street|road)\b[^\n|]*/gi, () => { removed.add("address"); return "[ADDRESS]"; });
  t = t.replace(/(\[REMOVED\][ \t]*\|?[ \t]*)+/g, "[REMOVED] ");

  return { text: t.trim(), fullName, email, removed: [...removed] };
}
