import { ConvexError } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT";

/**
 * Throw a typed, user-safe error. The client receives `data` as-is,
 * so the message must never contain internal details.
 */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
