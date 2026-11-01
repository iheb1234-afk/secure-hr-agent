/**
 * Layer 1 of prompt-injection defense: fast deterministic rules.
 * (Layer 2 = LLM classifier in lib/ai/classify.ts, Layer 3 = hidden-text detection in pdf.ts,
 *  Layer 4 = untrusted content is delimited and the model is told never to obey it.)
 */
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /ignore\s+(all\s+)?(of\s+)?(the\s+|your\s+|my\s+|any\s+)?(previous|prior|above|earlier|former)\s+(instructions|prompts|rules)/i, label: "Tries to override the AI's instructions" },
  { re: /disregard\s+(the\s+)?(job\s+)?(criteria|instructions|rules|requirements)/i, label: "Tries to make the AI ignore the job criteria" },
  { re: /\b(you are|if you are)\s+(an?\s+)?(ai|llm|language model|chatbot|bot|assistant|agentic)/i, label: "Text addressed to the AI, not to a human" },
  { re: /(note|message|instruction)s?\s+(to|for)\s+(the\s+)?(ai|llm|bot|model|recruit(er|ing)\s+(ai|bot|tool))/i, label: "Text addressed to the AI, not to a human" },
  { re: /(rank|score|rate)\s+(this|me|the)\s+(candidate|resume|cv|applicant)?\s*(first|highest|top|100|maximum|max)/i, label: "Asks for a specific ranking or score" },
  { re: /(give|assign)\s+(this|me|the)\s+(candidate|resume|cv)?\s*(the\s+)?(maximum|max|highest|perfect|full)\s+score/i, label: "Asks for a specific ranking or score" },
  { re: /(shortlist|hire|select|pass)\s+me\b/i, label: "Asks the AI to take a hiring decision" },
  { re: /\b(system|admin)\s+(note|prompt|message|override)\b/i, label: "Fake system / admin message" },
  { re: /(send|reveal|show|list|give|forward|share|export)\s+(me\s+)?(the\s+)?(list\s+of\s+)?(the\s+)?(other|all)\s+(the\s+)?(candidates?|applicants?|resumes|cvs|personal data)/i, label: "Tries to exfiltrate other candidates' data" },
  { re: /\b(ai|llm|gpt|chatbot)\s+(assistant|agent|bot|model|system)?\s*(reading|processing|analy[sz]ing|screening)\s+this/i, label: "Text addressed to the AI, not to a human" },
  { re: /<\/?(system|instructions?|resume|prompt|untrusted_document)>/i, label: "Tries to break out of the data delimiters" },
  { re: /\b(score|rating)\s*[:=]\s*100\b/i, label: "Asks for a specific ranking or score" },
  // added after reading Vigil's YARA rules and Rebuff's heuristics
  { re: /\b(forget|bypass|skip|overlook|override|neglect|do not follow|pay no attention to)\s+(all\s+)?(of\s+)?(the\s+|your\s+|any\s+)?(previous\s+|prior\s+|above\s+|earlier\s+|initial\s+|system\s+)?(instructions?|directives?|prompts?|rules|guidelines|criteria)\b/i, label: "Tries to override the AI's instructions" },
  { re: /<\|(im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>/i, label: "Fake chat-model control tokens" },
  { re: /\b(reveal|print|repeat|output|show|display)\s+(me\s+)?(all\s+)?(of\s+)?(your|the)\s+(system\s+|hidden\s+|initial\s+)?(prompt|instructions|rules)\b|\brepeat\s+(all\s+)?(of\s+)?(the\s+)?text\s+above/i, label: "Tries to extract the AI's instructions" },
  { re: /!\[[^\]]{0,80}\]\(\s*https?:\/\//i, label: "Hidden image link (data exfiltration trick)" },
  // French (Tunisian CVs are often in French)
  { re: /ignore[rz]?\s+(toutes\s+)?(les\s+)?instructions\s+(précédentes|precedentes|ci-dessus)/i, label: "Tries to override the AI's instructions (FR)" },
  { re: /oublie[rz]?\s+(toutes\s+)?(les\s+|tes\s+|vos\s+)?(instructions|consignes|règles|regles)/i, label: "Tries to override the AI's instructions (FR)" },
  { re: /(classe[rz]?|note[rz]?)\s+(ce|cette|moi)\s+(candidat|candidate|cv)?\s*(en\s+)?(premier|première|premiere|100|maximum)/i, label: "Asks for a specific ranking or score (FR)" },
  { re: /\bsi\s+(tu\s+es|vous\s+êtes|vous\s+etes)\s+(une?\s+)?(ia|intelligence artificielle|bot|robot)/i, label: "Text addressed to the AI, not to a human (FR)" },
];

export type RuleResult = { flagged: boolean; reasons: string[]; matches: string[] };

// ---------- Unicode tricks (inspired by LLM Guard's InvisibleText scanner) ----------
// Unicode "tag" characters (U+E0000–E007F): completely invisible, but LLMs can read them ("ASCII smuggling").
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
// Bidirectional overrides ("Trojan Source"): make text display in a different order than it is read.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
// Zero-width characters: can split words so filters miss them. (ZWNJ/ZWJ are kept: Arabic and Persian use them.)
const ZERO_WIDTH = /[​⁠﻿­]/g;
// Look-alike letters from other alphabets (Cyrillic/Greek) mapped to Latin
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "һ": "h", "ԛ": "q", "ԝ": "w",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I",
  "ο": "o", "α": "a", "ε": "e", "ι": "i", "ν": "v", "ρ": "p", "τ": "t", "κ": "k", "Ο": "O", "Α": "A", "Ε": "E", "Ι": "I", "Τ": "T",
};
const LATIN = /[A-Za-z]/;
const NON_LATIN_LOOKALIKE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`);

/** Removes invisible characters before text reaches the AI. */
export function stripInvisible(text: string): string {
  return text.replace(TAG_CHARS, "").replace(BIDI_CONTROLS, "").replace(ZERO_WIDTH, "");
}

/** Detects Unicode obfuscation and returns the text normalized for pattern matching. */
export function unicodeCheck(text: string): { normalized: string; reasons: string[] } {
  const reasons: string[] = [];
  if (TAG_CHARS.test(text)) reasons.push("Invisible Unicode tag characters (hidden message only an AI can read)");
  TAG_CHARS.lastIndex = 0;
  if (BIDI_CONTROLS.test(text)) reasons.push("Text-direction override characters (display differs from content)");
  BIDI_CONTROLS.lastIndex = 0;
  // a single word mixing Latin letters with look-alike Cyrillic/Greek letters = deliberate disguise
  const mixed = text.split(/\s+/).some((w) => LATIN.test(w) && NON_LATIN_LOOKALIKE.test(w));
  if (mixed) reasons.push("Words disguised with look-alike letters from another alphabet");

  // decode tag characters back to ASCII so the rules can read the hidden message too
  const decodedTags = [...text.matchAll(/[\u{E0020}-\u{E007E}]/gu)].map((m) => String.fromCodePoint(m[0].codePointAt(0)! - 0xe0000)).join("");
  const base = stripInvisible(text).normalize("NFKC").replace(/./gu, (c) => CONFUSABLES[c] ?? c);
  return { normalized: decodedTags ? `${base}\n${decodedTags}` : base, reasons };
}

export function scanRules(text: string): RuleResult {
  const reasons = new Set<string>();
  const matches: string[] = [];
  const u = unicodeCheck(text);
  u.reasons.forEach((r) => reasons.add(r));
  for (const { re, label } of PATTERNS) {
    const m = u.normalized.match(re);
    if (m) {
      reasons.add(label);
      matches.push(m[0]);
    }
  }
  return { flagged: reasons.size > 0, reasons: [...reasons], matches };
}
