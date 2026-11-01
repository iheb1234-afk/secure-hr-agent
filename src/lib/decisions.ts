// Shared by the API (validation) and the page (the reason picker).
export const REJECT_REASONS = [
  "Missing required skills",
  "Not enough experience",
  "Missing required qualification",
  "Manipulation attempt in the resume",
  "Position filled",
  "Candidate withdrew",
  "No reply",
  "Other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

// Going against the AI's score needs a written reason (EU AI Act Art. 14: human oversight, logged)
export const OVERRIDE = { shortlistBelow: 50, rejectFrom: 75 };
export const NOTE_MIN = 10;

export function needsNote(action: string, score: number | null, reason?: string): string | null {
  if (action === "reject" && reason === "Other") return "Describe the reason.";
  if (score === null) return null;
  if (action === "shortlist" && score < OVERRIDE.shortlistBelow) return `The AI scored this candidate ${score}/100. Say why you shortlist anyway.`;
  if (action === "reject" && score >= OVERRIDE.rejectFrom) return `The AI scored this candidate ${score}/100. Say why you reject anyway.`;
  return null;
}
