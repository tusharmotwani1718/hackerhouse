// ESLint flat config for Next.js apps (apps/web, apps/docs).
import prettier from "eslint-config-prettier";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier, // turn off rules that conflict with Prettier formatting
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
