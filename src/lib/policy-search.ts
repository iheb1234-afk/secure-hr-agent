// Simple, transparent retrieval: rank policy sections by shared keywords with the question (EN + FR).
// Deterministic and explainable: the employee sees exactly which sections the answer comes from.
export type Section = { id: string; doc: string; section: string; content: string };

const STOP = new Set(("the a an and or of to in on for is are am i my me do does did can could how what when where which who " +
  "much many have has with be at by it this that from as if not no yes please there their your you we our after before " +
  "le la les un une des de du et ou en au aux pour est sont je mon ma mes est-ce que qui quoi comment combien quand").split(" "));

const stem = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 6);
const words = (t: string) => t.split(/\s+/).map(stem).filter((w) => w.length > 2 && !STOP.has(w));

// a few synonyms so "vacation", "holiday", "congé" find the leave policy
const SYN: Record<string, string[]> = {
  vacati: ["leave", "annual"], holida: ["leave", "annual"], conge: ["leave"], conges: ["leave"], days: ["leave"],
  home: ["remote"], teletr: ["remote"], wfh: ["remote"], salary: ["payrol", "salari"], salair: ["payrol", "salari"],
  paid: ["payrol", "paid"], sick: ["sick"], malade: ["sick"], maladi: ["sick"], course: ["traini"], formati: ["traini"],
  certif: ["traini"], hours: ["hours", "workin"], horair: ["hours"], expens: ["expens"], frais: ["expens"], travel: ["travel"],
  harass: ["harass"], harcel: ["harass"], overti: ["overti"],
};

export function searchPolicies(question: string, sections: Section[], k = 3) {
  const q = new Set(words(question).flatMap((w) => [w, ...(SYN[w] ?? [])]));
  return sections
    .map((s) => {
      const title = new Set(words(`${s.doc} ${s.section}`));
      const body = words(s.content);
      let score = 0;
      for (const w of q) score += (title.has(w) ? 3 : 0) + body.filter((b) => b === w).length;
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Topics that always go to a human: personal, confidential or legally sensitive
const SENSITIVE: { re: RegExp; why: string }[] = [
  { re: /\b(salary|salaries|salaire|earn|gagne|paid)\b.*\b(colleagues?|coll[eè]gues?|coworkers?|my manager|my boss|other employees|others|autres)\b|\bhow much (does|do) (\w+ ){1,3}(earn|make|get paid)\b|\bcombien gagne\b/i, why: "Asks about someone else's pay (confidential)" },
  { re: /\b(harass|harc[eè]lement|discriminat|assault|agress|threat|menace)/i, why: "Harassment or discrimination: handled personally by HR" },
  { re: /\b(fired|licenci|dismiss|disciplin|sanction|resign|d[ée]mission|lawsuit|proc[eè]s)\b/i, why: "Employment decision or legal matter" },
  { re: /\b(pregnan|enceinte|depress|burn.?out|illness|maladie grave|disabilit|handicap|mental health)\b/i, why: "Personal health matter: handled confidentially by HR" },
];

export function sensitiveTopic(question: string): string | null {
  for (const s of SENSITIVE) if (s.re.test(question)) return s.why;
  return null;
}

// Grounding check (inspired by LLM Guard's FactualConsistency): every number in the AI's answer
// must appear in the cited handbook text or in the question itself. Otherwise it may be invented.
const NUM = /\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?/g;
const norm = (n: string) => n.replace(/[\s,](?=\d{3}\b)/g, "").replace(",", ".");
export function ungroundedNumbers(answer: string, sources: string[], question: string): string[] {
  const allowed = new Set([...`${sources.join(" ")} ${question}`.matchAll(NUM)].map((m) => norm(m[0])));
  return [...new Set([...answer.matchAll(NUM)].map((m) => norm(m[0])))].filter((n) => !allowed.has(n));
}
