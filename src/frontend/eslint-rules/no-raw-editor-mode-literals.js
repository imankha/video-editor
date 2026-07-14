/**
 * ESLint rule: no-raw-editor-mode-literals
 *
 * Drives (and keeps) EDITOR_MODES adoption (T4560): the editor-mode strings
 * 'framing' | 'overlay' | 'annotate' should come from the canonical constant
 * (EDITOR_MODES in stores/editorStore.js) rather than being re-typed as magic
 * strings. Raw literals scattered across the codebase are how the constant
 * drifts out of sync.
 *
 * Exempt by filename: the constant's home files are allowed to contain the raw
 * strings (that's where they are DEFINED). Default exemptions: any path segment
 * `constants/` and the file `editorStore.js`. Configure via the first option:
 *   ["warn", { exemptPathPatterns: ["constants/", "editorStore.js"] }]
 *
 * Severity note (T4290): the whole-`src` CI regression gate is frozen at
 * `--max-warnings 998` and is currently AT the ceiling. This rule therefore
 * ships `off` in the shared config; it flips to `warn` once EDITOR_MODES
 * adoption (T4560) lands and the warning baseline is ratcheted below 998.
 */

const MODE_LITERALS = new Set(["framing", "overlay", "annotate"]);
const DEFAULT_EXEMPT = ["constants/", "editorStore.js"];

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw editor-mode string literals ('framing'|'overlay'|'annotate'); use the EDITOR_MODES constant instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          exemptPathPatterns: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawMode:
        "Raw editor-mode literal '{{value}}'. Import and use EDITOR_MODES.{{constName}} (stores/editorStore.js) instead of the magic string.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const exempt = options.exemptPathPatterns || DEFAULT_EXEMPT;
    const filename = (context.filename || "").replace(/\\/g, "/");
    if (exempt.some((pat) => filename.includes(pat))) return {};

    return {
      Literal(node) {
        if (typeof node.value !== "string" || !MODE_LITERALS.has(node.value)) return;
        context.report({
          node,
          messageId: "rawMode",
          data: { value: node.value, constName: node.value.toUpperCase() },
        });
      },
    };
  },
};

export default rule;
