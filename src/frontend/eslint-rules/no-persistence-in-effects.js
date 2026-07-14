/**
 * ESLint rule: no-persistence-in-effects
 *
 * Machine-enforces the project's most important sync invariant (CLAUDE.md §
 * "Persistence: Gesture-Based, Never Reactive"): the app NEVER writes to the
 * backend or mutates a store as a side effect of state changing. Every DB write
 * must trace back to a named user gesture. A reactive `useEffect` that persists
 * hook state creates the feedback loop that corrupted keyframe origins (T350)
 * and lost shadow versions (T4020).
 *
 * This rule flags WRITE-verb persistence inside a `useEffect`/`useLayoutEffect`
 * callback. It deliberately does NOT flag reads: `fetch`/`apiFetch` with the
 * default GET is legitimate fetch-on-mount data LOADING.
 *
 * Flagged shapes (kept narrow to keep false positives low):
 *   1. `apiFetch(url, { method: 'POST'|'PUT'|'PATCH'|'DELETE' })` /
 *      `fetch(url, { method: <write verb> })` — case-insensitive.
 *   2. `<anything>.setState(...)` — direct store/component state writes.
 *   3. `use*Store.getState().<mutator>(...)` — cross-store action calls, where
 *      <mutator> begins with set/add/update/remove/delete/clear/reset/toggle/save/push.
 *
 * SCOPE — nearest-enclosing-function gate (keeps false positives at zero on the
 * current codebase; verified against all 21 raw hits, every one legitimate):
 * a write is flagged ONLY when its NEAREST enclosing function is the effect
 * callback itself OR a directly-invoked IIFE `(async () => { ... })()`. That is
 * exactly the synchronous "runs when state changes" body that caused the T350
 * feedback loop. Writes reached only through a DEFERRED or SEPARATE execution
 * context are NOT flagged, because those are load/reconciliation/teardown, not
 * reactive persistence of edit state:
 *   - effect CLEANUP return functions (e.g. `return () => store.reset()`),
 *   - callbacks passed to `.then()`/`setTimeout`/`setInterval`/`addEventListener`,
 *   - named helper functions declared in the effect and called for a load flow
 *     (e.g. `async function resolve() { await apiFetch(GET); await apiFetch(POST) }`).
 * Known limitation (documented, acceptable for v1): a write buried in a named
 * helper is not caught. The canonical persistence bug is synchronous-body or a
 * top-level IIFE, which IS caught.
 *
 * Escape hatch: an author with a legitimate case must use ESLint's built-in
 * disable with a NAMED-GESTURE justification, e.g.
 *   // eslint-disable-next-line local/no-persistence-in-effects -- gesture: export button flushes state
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MUTATOR_PREFIX = /^(set|add|update|remove|delete|clear|reset|toggle|save|push)/;
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

/** Is this callee a call to useEffect / useLayoutEffect (bare or React.*)? */
function isEffectCallee(callee) {
  if (callee.type === "Identifier") return EFFECT_HOOKS.has(callee.name);
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return EFFECT_HOOKS.has(callee.property.name);
  }
  return false;
}

function isFunctionNode(node) {
  return (
    node &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration")
  );
}

/** Is `fnNode` a directly-invoked IIFE, i.e. `(fn)()`? */
function isIIFE(fnNode) {
  const p = fnNode.parent;
  return p && p.type === "CallExpression" && p.callee === fnNode;
}

/** Callee is `apiFetch` / `fetch` (bare identifier or `x.apiFetch` / `x.fetch`). */
function isFetchCallee(callee) {
  if (callee.type === "Identifier") return callee.name === "fetch" || callee.name === "apiFetch";
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return callee.property.name === "fetch" || callee.property.name === "apiFetch";
  }
  return false;
}

/** Does any argument carry an options object with a write-verb `method`? */
function hasWriteMethodArg(node) {
  for (const arg of node.arguments) {
    if (arg.type !== "ObjectExpression") continue;
    for (const prop of arg.properties) {
      if (prop.type !== "Property" || prop.computed) continue;
      const key = prop.key;
      const keyName =
        key.type === "Identifier" ? key.name : key.type === "Literal" ? key.value : null;
      if (keyName !== "method") continue;
      const val = prop.value;
      if (val.type === "Literal" && typeof val.value === "string") {
        if (WRITE_METHODS.has(val.value.toUpperCase())) return true;
      }
    }
  }
  return false;
}

/** `use*Store.getState()` call expression? */
function isStoreGetState(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "getState" &&
    node.callee.object.type === "Identifier" &&
    /^use[A-Z].*Store$/.test(node.callee.object.name)
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban reactive persistence (write-verb apiFetch/fetch, setState, cross-store mutators) inside useEffect/useLayoutEffect; persistence must be gesture-based.",
    },
    schema: [],
    messages: {
      persistWrite:
        "Reactive persistence inside {{hook}} is banned (CLAUDE.md: gesture-based, never reactive). This {{kind}} writes as a side effect of state changing, which corrupts data (T350/T4020). Move the write into the user-gesture handler that caused the change. If this is genuinely gesture-triggered, add: // eslint-disable-next-line local/no-persistence-in-effects -- gesture: <name the gesture>",
    },
  },

  create(context) {
    // Maps an effect-callback function node -> the hook name that owns it.
    const effectCallbacks = new Map();

    // Walk ancestors of `node`. Return the enclosing effect hook name ONLY if
    // `node`'s nearest enclosing function is the effect callback itself or a
    // directly-invoked IIFE chain up to it (see SCOPE note in the file header).
    // Crossing any OTHER function (named helper, .then/timer/listener callback,
    // cleanup return) on the way up means `node` is in a deferred/separate
    // context, not the reactive body — return null (not flagged).
    function enclosingEffectHook(node) {
      let cur = node.parent;
      let crossedOpaqueFn = false;
      while (cur) {
        if (effectCallbacks.has(cur)) {
          return crossedOpaqueFn ? null : effectCallbacks.get(cur);
        }
        if (isFunctionNode(cur) && !isIIFE(cur)) {
          // A non-IIFE function boundary between the write and the effect body.
          crossedOpaqueFn = true;
        }
        cur = cur.parent;
      }
      return null;
    }

    function report(node, kind) {
      const hook = enclosingEffectHook(node);
      if (!hook) return;
      context.report({ node, messageId: "persistWrite", data: { hook, kind } });
    }

    return {
      CallExpression(node) {
        // Register effect callbacks as we descend (parent visited before children).
        if (isEffectCallee(node.callee) && isFunctionNode(node.arguments[0])) {
          const hookName =
            node.callee.type === "MemberExpression"
              ? node.callee.property.name
              : node.callee.name;
          effectCallbacks.set(node.arguments[0], hookName);
        }

        // 1. write-verb apiFetch/fetch
        if (isFetchCallee(node.callee) && hasWriteMethodArg(node)) {
          report(node, "write-verb fetch");
          return;
        }

        // 2 & 3. member calls: `.setState(...)` and `use*Store.getState().<mutator>(...)`
        if (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
          const method = node.callee.property.name;
          if (method === "setState") {
            report(node, "setState call");
            return;
          }
          if (isStoreGetState(node.callee.object) && MUTATOR_PREFIX.test(method)) {
            report(node, "cross-store mutator");
          }
        }
      },
    };
  },
};

export default rule;
