import { LIMITS } from "./constants";
import { fail } from "./errors";

/** Trim, collapse whitespace and enforce length. Returns the clean value. */
export function cleanText(
  value: string,
  field: string,
  min: number,
  max: number,
): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length < min) {
    fail("INVALID_INPUT", `${field} must be at least ${min} characters.`);
  }
  if (clean.length > max) {
    fail("INVALID_INPUT", `${field} must be at most ${max} characters.`);
  }
  return clean;
}

export function cleanToolFields(input: { name: string; description: string }) {
  return {
    name: cleanText(input.name, "Name", LIMITS.toolName.min, LIMITS.toolName.max),
    description: cleanText(
      input.description,
      "Description",
      LIMITS.description.min,
      LIMITS.description.max,
    ),
  };
}

export function cleanOptionalMessage(message: string | undefined) {
  if (message === undefined) return undefined;
  const clean = message.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return undefined;
  if (clean.length > LIMITS.message.max) {
    fail("INVALID_INPUT", `Message must be at most ${LIMITS.message.max} characters.`);
  }
  return clean;
}
