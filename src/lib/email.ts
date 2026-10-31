// Added by the server to every email at send time (EU AI Act: candidates must be told AI was used in screening).
export const SCREENING_NOTICE =
  "Your application was screened with the help of AI. Every decision was made by a person, and you can ask for a human review by replying to this email.";

export const withNotice = (body: string) => `${body.trimEnd()}\n\n--\n${SCREENING_NOTICE}`;

/** The AI sometimes returns an email as one block of text: rebuild greeting, paragraphs and sign-off. */
export function formatEmail(body: string): string {
  const text = body.replace(/\r/g, "").trim();
  if (text.includes("\n")) return text; // already laid out by the AI: leave it
  let rest = text.replace(/\s*\n\s*/g, " ");
  let greeting = "";
  const g = rest.match(/^((?:Dear|Hello|Hi|Bonjour)\b[^,!\n]{0,60}[,!])\s*/i);
  if (g) { greeting = g[1]; rest = rest.slice(g[0].length); }
  let signoff = "";
  const s = rest.match(/\s*((?:Best|Kind|Warm)(?:est)? regards|Sincerely|Regards|Best wishes|Cordialement)\s*,?\s*(.*)$/i);
  if (s && s.index !== undefined) { signoff = `${s[1]},\n${s[2].trim()}`.trim(); rest = rest.slice(0, s.index); }
  // split only at ". " followed by a capital, so "Node.js" or "e.g." never lose text
  const sentences = rest.split(/(?<=[.!?])\s+(?=[A-Z{"'])/).map((x) => x.trim()).filter(Boolean);
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) paras.push(sentences.slice(i, i + 2).join(" "));
  return [greeting, ...paras, signoff].filter(Boolean).join("\n\n");
}
