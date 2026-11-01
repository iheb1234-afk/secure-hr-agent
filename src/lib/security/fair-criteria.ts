/**
 * Fairness check for job criteria (inspired by Ashby's EEO validation of AI criteria).
 * A criterion must be about the job, never about who the person is. Plain code, EN + FR.
 */
// whole words only, accent-aware (so "manage" never matches "age", but "marié(e)" matches)
const words = (list: string) => new RegExp(`(?<![\\p{L}\\d])(?:${list})(?![\\p{L}])`, "iu");

const PROTECTED: { re: RegExp; label: string }[] = [
  { re: words("age|aged|âge|years old|under \\d{2}|over \\d{2}|moins de \\d{2} ans|plus de \\d{2} ans|young|jeune"), label: "age" },
  { re: words("male|female|man|woman|men|women|homme|femme|gender|sexe|genre"), label: "gender" },
  { re: words("nationality|nationalité|citizen|citizenship|born in|née? en|origin|origine|race|ethnic|ethnicity|ethnie"), label: "origin or nationality" },
  { re: words("native speaker|langue maternelle"), label: "origin (write \"fluent\" instead of \"native\")" },
  { re: words("religion|religious|muslim|musulmane?|christian|chrétienne?|jewish|juive?"), label: "religion" },
  { re: words("married|single|mariée?|marié\\(e\\)|célibataire|children|enfants|pregnant|pregnancy|enceinte|family status|situation familiale"), label: "family status" },
  { re: words("photo|picture|appearance|apparence|physique|good-looking|height|weight|poids"), label: "physical appearance" },
  { re: words("disability|disabled|handicap|handicapée?|good health|bonne santé|health condition|état de santé"), label: "health or disability" },
];

export function unfairCriterion(text: string): string | null {
  for (const { re, label } of PROTECTED) if (re.test(text)) return label;
  return null;
}
