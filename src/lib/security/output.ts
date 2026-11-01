/**
 * Output check (OWASP LLM05): an email the AI helped write is scanned right before it leaves.
 * Catches tricks a manipulated model could slip into an email: hidden tracking images,
 * links that carry data out in their query string, and chat-model control tokens.
 * Plain links (for example a portfolio URL typed by the recruiter) are allowed.
 */
const RULES: { re: RegExp; label: string }[] = [
  { re: /!\[[^\]]*\]\([^)]*\)/, label: "a hidden image link" },
  { re: /<\s*img\b/i, label: "an embedded image tag" },
  { re: /https?:\/\/[^\s)>"']+\?[^\s)>"']*=/i, label: "a link that carries data in its address" },
  { re: /<\|(im_start|im_end|system|user|assistant)\|>|\[\/?INST\]|<<\/?SYS>>/i, label: "chat-model control tokens" },
];

export function scanOutgoingEmail(text: string): { label: string; match: string } | null {
  for (const { re, label } of RULES) {
    const m = text.match(re);
    if (m) return { label, match: m[0].slice(0, 80) };
  }
  return null;
}
