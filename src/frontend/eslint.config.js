import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
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
      "no-duplicate-imports": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      eqeqeq: ["warn", "smart"],
    },
  },
  {
    // Test file overrides
    files: ["**/*.test.{js,jsx}", "**/__tests__/**"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.vitest,
      },
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.config.js", "*.config.mjs"],
  },
];
