/**
 * Shared constants used by both Convex functions and the Next.js UI.
 * Keeping them in one place means the UI can never offer a value
 * that the backend would reject.
 */

export const CATEGORIES = [
  { value: "power_tools", label: "Power tools" },
  { value: "hand_tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "ladders", label: "Ladders & access" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "well_used", label: "Well used" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];
export type Condition = (typeof CONDITIONS)[number]["value"];

export const LIMITS = {
  toolName: { min: 2, max: 60 },
  description: { min: 10, max: 400 },
  message: { max: 300 },
  /** Longest loan a borrower can request, in days (inclusive). */
  maxLoanDays: 30,
  /** How far ahead a borrower can book, in days. */
  maxDaysAhead: 90,
  /** Max rows any list query returns (keeps reads bounded). */
  listPageSize: 200,
} as const;

export const LOAN_STATUSES = [
  "requested",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function conditionLabel(value: string): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}
