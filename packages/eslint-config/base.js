// Base ESLint flat config for non-Next.js TypeScript packages (e.g. packages/db, scripts).
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier, // turn off rules that conflict with Prettier formatting
  globalIgnores(["dist/**", "build/**", "coverage/**", ".turbo/**"]),
]);
