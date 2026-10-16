import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  /* The create-plugin skill's examples are plugins as the agents write
     them (plain JS for the sandbox), checked by PluginCheck in their test. */
  globalIgnores([".next/**", ".next-zero/**", "out/**", "next-env.d.ts", "professions/**/examples/**"]),
]);
