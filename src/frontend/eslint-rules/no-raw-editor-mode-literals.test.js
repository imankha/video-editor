/**
 * RuleTester unit tests for local/no-raw-editor-mode-literals, run under vitest.
 */
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-raw-editor-mode-literals.js";

// Wire RuleTester's hooks to vitest and call run() at module top level so each
// case registers as a real vitest test (see no-persistence-in-effects.test.js).
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-raw-editor-mode-literals", rule, {
      valid: [
        // Non-mode strings are untouched.
        { code: `const x = 'gallery';`, filename: "src/components/Foo.jsx" },
        // Using the constant (not a raw literal) is the whole point — fine.
        { code: `const x = EDITOR_MODES.FRAMING;`, filename: "src/components/Foo.jsx" },
        // Exempt by filename: the constant's definition file.
        { code: `const m = 'framing';`, filename: "src/stores/editorStore.js" },
        // Exempt by filename: anything under a constants/ segment.
        { code: `export const M = 'overlay';`, filename: "src/constants/editorModes.js" },
      ],
      invalid: [
        {
          code: `const mode = 'framing';`,
          filename: "src/components/Foo.jsx",
          errors: [{ messageId: "rawMode" }],
        },
        {
          code: `if (mode === 'overlay') { doThing(); }`,
          filename: "src/hooks/useThing.js",
          errors: [{ messageId: "rawMode" }],
        },
        {
          code: `const arr = ['annotate', 'overlay'];`,
          filename: "src/components/Bar.jsx",
          errors: [{ messageId: "rawMode" }, { messageId: "rawMode" }],
        },
      ],
});
