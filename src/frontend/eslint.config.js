import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import noPersistenceInEffects from "./eslint-rules/no-persistence-in-effects.js";
import noRawEditorModeLiterals from "./eslint-rules/no-raw-editor-mode-literals.js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      // Project-local guardrail rules (T4290) — machine-enforce the persistence
      // & constants conventions that used to live only in prose (CLAUDE.md).
      local: {
        rules: {
          "no-persistence-in-effects": noPersistenceInEffects,
          "no-raw-editor-mode-literals": noRawEditorModeLiterals,
        },
      },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        // Vite build-time defines (statically replaced in the client bundle):
        __COMMIT_HASH__: "readonly", // vite.config.js `define`
        process: "readonly", // process.env.NODE_ENV is replaced by Vite/esbuild at build
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React rules
      "react/jsx-uses-react": "off", // Not needed with React 17+ JSX transform
      "react/react-in-jsx-scope": "off", // Not needed with React 17+ JSX transform
      "react/prop-types": "off", // No PropTypes in this project
      "react/jsx-key": "warn",
      "react/no-unescaped-entities": "warn",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // General quality rules
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off", // Project uses console for debugging
      "no-debugger": "warn",
      // Empty catch is allowed for best-effort calls to unreliable browser APIs
      // (video.currentTime/play, wakeLock) where failure is safely ignorable.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-duplicate-imports": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      eqeqeq: ["warn", "smart"],

      // T4290 guardrails
      // Rule 1 (ERROR): reactive persistence inside useEffect/useLayoutEffect is
      // banned (CLAUDE.md: gesture-based, never reactive). Zero clean-scoped
      // violations exist today, so this can ship as a hard error.
      "local/no-persistence-in-effects": "error",
      // Rule 2 (OFF for now): raw editor-mode literals. The whole-`src` CI
      // regression gate is frozen at `--max-warnings 998` and is currently AT the
      // ceiling (998/998). Enabling this as `warn` would push totals over 998 and
      // turn the gate RED, and the gate may only ratchet DOWN. It stays `off`
      // until EDITOR_MODES adoption (T4560) lands and the warning baseline is
      // ratcheted below the ceiling — then flip to "warn". Rule + tests ship now.
      "local/no-raw-editor-mode-literals": "off",
    },
  },
  {
    // Test file overrides
    files: ["**/*.test.{js,jsx}", "**/__tests__/**"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.vitest,
        ...globals.node, // vitest tests use Node globals (e.g. `global` for fetch mocking)
      },
    },
  },
  {
    // Playwright e2e specs run under Node (process.env params, etc.)
    files: ["e2e/**/*.{js,jsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.config.js", "*.config.mjs"],
  },
];
