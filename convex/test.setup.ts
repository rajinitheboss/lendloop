/// <reference types="vite/client" />
// Lets convex-test load every Convex module in this folder.
export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);
