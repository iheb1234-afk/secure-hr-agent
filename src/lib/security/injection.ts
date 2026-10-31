/**
 * Layer 1 of prompt-injection defense: fast deterministic rules.
 * (Layer 2 = LLM classifier in lib/ai/classify.ts, Layer 3 = hidden-text detection in pdf.ts,
 *  Layer 4 = untrusted content is delimited and the model is told never to obey it.)
 */
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i, label: "Tries to override the AI's instructions" },
  { re: /disregard\s+(the\s+)?(job\s+)?(criteria|instructions|rules|requirements)/i, label: "Tries to make the AI ignore the job criteria" },
  { re: /\b(you are|if you are)\s+(an?\s+)?(ai|llm|language model|chatbot|bot|assistant|agentic)/i, label: "Text addressed to the AI, not to a human" },
  { re: /(note|message|instruction)s?\s+(to|for)\s+(the\s+)?(ai|llm|bot|model|recruit(er|ing)\s+(ai|bot|tool))/i, label: "Text addressed to the AI, not to a human" },
  { re: /(rank|score|rate)\s+(this|me|the)\s+(candidate|resume|cv|applicant)?\s*(first|highest|top|100|maximum|max)/i, label: "Asks for a specific ranking or score" },
  { re: /(give|assign)\s+(this|me|the)\s+(candidate|resume|cv)?\s*(the\s+)?(maximum|max|highest|perfect|full)\s+score/i, label: "Asks for a specific ranking or score" },
  { re: /(shortlist|hire|select|pass)\s+me\b/i, label: "Asks the AI to take a hiring decision" },
  { re: /\b(system|admin)\s+(note|prompt|message|override)\b/i, label: "Fake system / admin message" },
  { re: /(send|reveal|show|list|give)\s+(me\s+)?(the\s+)?(list\s+of\s+)?(the\s+)?(other|all)\s+(candidates|applicants|resumes)/i, label: "Tries to exfiltrate other candidates' data" },
  { re: /<\/?(system|instructions?|resume|prompt|untrusted_document)>/i, label: "Tries to break out of the data delimiters" },
  { re: /\b(score|rating)\s*[:=]\s*100\b/i, label: "Asks for a specific ranking or score" },
  // French (Tunisian CVs are often in French)
  { re: /ignore[rz]?\s+(toutes\s+)?(les\s+)?instructions\s+(précédentes|precedentes|ci-dessus)/i, label: "Tries to override the AI's instructions (FR)" },
  { re: /(classe[rz]?|note[rz]?)\s+(ce|cette|moi)\s+(candidat|candidate|cv)?\s*(en\s+)?(premier|première|premiere|100|maximum)/i, label: "Asks for a specific ranking or score (FR)" },
  { re: /\bsi\s+(tu\s+es|vous\s+êtes|vous\s+etes)\s+(une?\s+)?(ia|intelligence artificielle|bot|robot)/i, label: "Text addressed to the AI, not to a human (FR)" },
];

export type RuleResult = { flagged: boolean; reasons: string[]; matches: string[] };

export function scanRules(text: string): RuleResult {
  const reasons = new Set<string>();
  const matches: string[] = [];
  for (const { re, label } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      reasons.add(label);
      matches.push(m[0]);
    }
  }
  return { flagged: reasons.size > 0, reasons: [...reasons], matches };
}
