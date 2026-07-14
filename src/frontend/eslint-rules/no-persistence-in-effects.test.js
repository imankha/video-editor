/**
 * RuleTester unit tests for local/no-persistence-in-effects, run under vitest.
 *
 * RuleTester validates a rule by feeding it `valid` and `invalid` source
 * samples and asserting the exact set of reported errors. We must wire
 * RuleTester's test hooks to vitest's `it`/`describe` and call `run` at the
 * MODULE TOP LEVEL (during collection) — RuleTester then registers each case as
 * a real vitest test. Calling `run` *inside* an `it()` would nest test
 * registrations that vitest never executes, so invalid cases would pass
 * vacuously (verified: a no-op rule mutant is correctly caught with this wiring).
 */
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "./no-persistence-in-effects.js";

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

ruleTester.run("no-persistence-in-effects", rule, {
      valid: [
        // (b) allowed: the SAME write-verb apiFetch, but in a gesture handler,
        // not inside an effect.
        {
          code: `
            function Editor() {
              const handleSave = () => {
                apiFetch('/api/clips/1', { method: 'PUT', body: '{}' });
              };
              return handleSave;
            }
          `,
        },
        // (c) allowed: effect body with a GET load (fetch-on-mount is legit).
        {
          code: `
            function Editor() {
              useEffect(() => {
                apiFetch('/api/clips/1');
                fetch('/api/games', { method: 'GET' });
              }, []);
            }
          `,
        },
        // GET is the default and must not flag even with an options object.
        {
          code: `
            function Editor() {
              useEffect(() => {
                apiFetch('/api/clips/1', { credentials: 'include' });
              }, []);
            }
          `,
        },
        // setState outside any effect is fine (e.g. inside an event handler).
        {
          code: `
            function Editor() {
              const onClick = () => useStore.setState({ a: 1 });
              return onClick;
            }
          `,
        },
        // Reading store state inside an effect is fine; only mutators flag.
        {
          code: `
            function Editor() {
              useEffect(() => {
                const val = useEditorStore.getState().editorMode;
                console.log(val);
              }, []);
            }
          `,
        },
        // SCOPE: write in a .then() callback is a deferred load flow, not the
        // reactive body — not flagged (mirrors App.jsx bootstrap hydration).
        {
          code: `
            function Editor() {
              useEffect(() => {
                initSession().then(() => {
                  apiFetch('/api/x', { method: 'POST' });
                  useProfileStore.getState().setFromBootstrap(data);
                });
              }, []);
            }
          `,
        },
        // SCOPE: cross-store mutator in a cleanup RETURN is teardown, not
        // reactive persistence (mirrors OverlayScreen reset()).
        {
          code: `
            function Editor() {
              useEffect(() => {
                return () => useOverlayActionStore.getState().reset();
              }, [projectId]);
            }
          `,
        },
        // SCOPE: write in a named helper function declared in the effect is a
        // load/reconciliation flow (mirrors SharedAnnotationView resolve()).
        {
          code: `
            function Editor() {
              useEffect(() => {
                async function resolve() {
                  await apiFetch('/api/profiles');
                  await apiFetch('/api/resolve', { method: 'POST' });
                }
                resolve();
              }, [a, b]);
            }
          `,
        },
        // SCOPE: mutator inside a setInterval callback is a deferred timer, not
        // the reactive body (mirrors useVideo loading-progress interval).
        {
          code: `
            function Editor() {
              useEffect(() => {
                const id = setInterval(() => {
                  useVideoStore.getState().setLoadingElapsedSeconds(1);
                }, 1000);
                return () => clearInterval(id);
              }, [isLoading]);
            }
          `,
        },
      ],
      invalid: [
        // (a) banned: effect body with a PUT apiFetch.
        {
          code: `
            function Editor() {
              useEffect(() => {
                apiFetch('/api/clips/1', { method: 'PUT', body: '{}' });
              }, []);
            }
          `,
          errors: [{ messageId: "persistWrite" }],
        },
        // banned: lowercase method verb (case-insensitive) via bare fetch.
        {
          code: `
            function Editor() {
              useLayoutEffect(() => {
                fetch('/api/clips/1', { method: 'post' });
              }, []);
            }
          `,
          errors: [{ messageId: "persistWrite" }],
        },
        // banned: setState inside an effect.
        {
          code: `
            function Editor() {
              useEffect(() => {
                useExportStore.setState({ status: 'done' });
              }, []);
            }
          `,
          errors: [{ messageId: "persistWrite" }],
        },
        // banned: cross-store mutator via getState() inside an effect.
        {
          code: `
            function Editor() {
              useEffect(() => {
                useProjectsStore.getState().setActiveProject(id);
              }, []);
            }
          `,
          errors: [{ messageId: "persistWrite" }],
        },
        // banned even when nested in an async IIFE inside the effect.
        {
          code: `
            function Editor() {
              useEffect(() => {
                (async () => {
                  await apiFetch('/api/clips/1', { method: 'DELETE' });
                })();
              }, []);
            }
          `,
          errors: [{ messageId: "persistWrite" }],
        },
      ],
});

// (d) disable-comment case: a real ESLint run must honor the built-in
// eslint-disable-next-line. RuleTester does not process disable directives,
// so we assert the escape hatch through the Linter instead.
describe("no-persistence-in-effects escape hatch", () => {
  it("honors an eslint-disable-next-line with a named-gesture justification", async () => {
    const { Linter } = await import("eslint");
    const linter = new Linter();
    const code = [
      "function Editor() {",
      "  useEffect(() => {",
      "    // eslint-disable-next-line local/no-persistence-in-effects -- gesture: export button flush",
      "    apiFetch('/api/clips/1', { method: 'PUT' });",
      "  }, []);",
      "}",
    ].join("\n");
    const messages = linter.verify(code, {
      plugins: { local: { rules: { "no-persistence-in-effects": rule } } },
      rules: { "local/no-persistence-in-effects": "error" },
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    });
    const violations = messages.filter((m) => m.ruleId === "local/no-persistence-in-effects");
    if (violations.length !== 0) {
      throw new Error(`expected disable comment to suppress rule, got: ${JSON.stringify(messages)}`);
    }
  });
});
