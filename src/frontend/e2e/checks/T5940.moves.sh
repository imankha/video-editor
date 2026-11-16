#!/usr/bin/env bash
# T5940:C2 / T5940:C3 - the admin.py split is a sequence of small, motion-only commits.
#
#   c2: each sub-router lands in its own commit (one new routers/admin/<name>.py per Move commit)
#       and every Move commit (plus the package commit) has < ~200 lines of meaningful diff:
#       a removed line that reappears as an added line elsewhere in the same commit is motion,
#       not meaningful diff, and blank lines are ignored.
#   c3: no commit mixes motion with behaviour change. For every Move commit (plus the package
#       commit), the multiset of top-level definitions in the backend app code it touches
#       (functions, classes, module-level statements, compared by AST so moving a block and
#       deepening its relative imports is invisible) is the same before and after, apart from the
#       wiring a move needs (imports, the new module's router/logger, include_router, __all__,
#       docstrings). Test and check files may differ only in the module path they patch or name.
#       The analytics service extraction is the last Move commit.
#
# Run from the repo root: bash src/frontend/e2e/checks/T5940.moves.sh c2|c3 [base-ref]
set -euo pipefail
MODE=${1:?usage: T5940.moves.sh c2|c3 [base-ref]}
BASE=${2:-origin/master}
git rev-parse --verify -q "$BASE" >/dev/null || BASE=master

python3 - "$MODE" "$BASE" <<'PY'
import ast, collections, re, subprocess, sys

mode, base = sys.argv[1], sys.argv[2]
LIMIT = 200
SUBS = "bugs|referrals|campaigns|revenue|ops|credits|users|session|analytics"


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


log = git("log", "--reverse", "--format=%H %s", f"{base}..HEAD").splitlines()
package = [l.split(" ", 1) for l in log if l.split(" ", 1)[1].startswith("T5940: Turn routers/admin.py into")]
moves = [l.split(" ", 1) for l in log if l.split(" ", 1)[1].startswith("T5940: Move ")]
if len(package) != 1 or len(moves) < 10:
    sys.exit(f"FAIL: expected 1 package commit and >= 10 Move commits, found {len(package)} and {len(moves)}")
commits = package + moves
failures = []


def changed(sha):
    """[(status, old_path, new_path)] for the commit, renames detected."""
    out = []
    for line in git("diff", "--name-status", "-M", f"{sha}^", sha).splitlines():
        parts = line.split("\t")
        st = parts[0][0]
        out.append((st, parts[1], parts[-1]) if st == "R" else (st, parts[1], parts[1]))
    return out


def show(sha, path):
    r = subprocess.run(["git", "show", f"{sha}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def meaningful(sha):
    rem, add = collections.Counter(), collections.Counter()
    for l in git("diff", "--no-color", "--no-ext-diff", "-M", f"{sha}^", sha).splitlines():
        if l.startswith(("+++ ", "--- ")) or l[:1] not in "+-":
            continue
        s = l[1:].strip()
        if s:
            (rem if l[0] == "-" else add)[s] += 1
    moved = rem & add
    return sum((rem - moved).values()) + sum((add - moved).values())


if mode == "c2":
    for sha, subj in commits:
        n = meaningful(sha)
        new_routers = [p for st, _, p in changed(sha)
                       if st == "A" and re.fullmatch(rf"src/backend/app/routers/admin/({SUBS})\.py", p)]
        print(f"{sha[:9]} meaningful={n:4d} new_sub_routers={new_routers}  {subj}")
        if n > LIMIT:
            failures.append(f"{sha[:9]} has {n} meaningful diff lines (> {LIMIT})")
        m = re.search(r"routers/admin/([a-z]+)\.py$", subj)
        if subj.startswith("T5940: Move the ") and m and new_routers != [f"src/backend/app/routers/admin/{m.group(1)}.py"]:
            failures.append(f"{sha[:9]} should add exactly routers/admin/{m.group(1)}.py, added {new_routers}")
    landed = [re.search(r"routers/admin/([a-z]+)\.py$", s).group(1) for _, s in moves
              if re.search(r"routers/admin/([a-z]+)\.py$", s)]
    if sorted(landed) != sorted(SUBS.split("|")) :
        failures.append(f"sub-router commits {sorted(landed)} != the 9 sub-routers")

if mode == "c3":
    WIRING_NAMES = {"router", "open_router", "logger", "__all__"}

    def norm_text(s):
        s = re.sub(rf"app\.routers\.admin\.({SUBS})\b", "app.routers.admin", s)
        s = re.sub(rf"routers/admin/({SUBS}|__init__)\.py", "routers/admin.py", s)
        s = re.sub(r"routers/admin/", "routers/admin.py", s)
        return s

    class StripImports(ast.NodeTransformer):
        """Imports anywhere (also inside functions) are move wiring: a moved block's relative
        depth changes, and code left behind imports what moved away."""
        def visit_Import(self, node):
            return None

        visit_ImportFrom = visit_Import

    class Norm(StripImports):
        """Erase what a move legitimately changes in a test: the module path and alias."""
        def visit_Constant(self, node):
            if isinstance(node.value, str):
                node.value = norm_text(node.value)
            return node

        def visit_Name(self, node):
            node.id = re.sub(rf"^admin_({SUBS})$", "admin", node.id)
            return node

        def generic_visit(self, node):
            # A moved handler keeps its own module-level binding (e.g. get_pg), so a fixture
            # that patched it once now patches it at each module: identical after normalising.
            node = super().generic_visit(node)
            body = getattr(node, "body", None)
            if isinstance(body, list):
                seen, kept = set(), []
                for stmt in body:
                    d = ast.dump(stmt)
                    if d not in seen:
                        seen.add(d)
                        kept.append(stmt)
                node.body = kept
            return node

    def app_units(src):
        """Top-level statements of an app module, minus move wiring, as AST dumps."""
        units = collections.Counter()
        for node in StripImports().visit(ast.parse(src)).body:
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
                continue  # docstring
            if isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id in WIRING_NAMES
                                                    for t in node.targets):
                continue
            if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                    and ast.unparse(node.value.func) == "app.include_router"):
                continue
            units[ast.dump(node)] += 1
        return units

    def test_units(src):
        tree = Norm().visit(ast.parse(src))
        units = collections.Counter()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body and \
                    isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant):
                node.body = node.body[1:] or [ast.Pass()]
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
                continue
            units[ast.dump(node)] += 1
        return units

    # Test-side rewiring a move cannot express as a path rename, reviewed one by one.
    ALLOWED = {
        # admin.py was skipped by file name; the package is skipped by directory.
        ("daaf8e717", "src/backend/tests/test_t14540_server_error_copy.py"),
        # list_users moved to admin/users.py while the other dashboard handlers the test
        # drives stayed in admin/__init__.py: getattr picks the module per handler.
        ("3a936a7c4", "src/backend/tests/test_t8000_admin_analytics_concurrency.py"),
    }

    for sha, subj in commits:
        app_before, app_after = collections.Counter(), collections.Counter()
        notes = []
        for st, old, new in changed(sha):
            if old.startswith("src/backend/app/") or new.startswith("src/backend/app/"):
                if not new.endswith(".py"):
                    failures.append(f"{sha[:9]} touches non-Python app file {new}")
                    continue
                b, a = show(f"{sha}^", old), show(sha, new)
                app_before += app_units(b) if b else collections.Counter()
                app_after += app_units(a) if a else collections.Counter()
            elif new.endswith(".py"):
                b, a = show(f"{sha}^", old), show(sha, new)
                if b is None or a is None or test_units(b) != test_units(a):
                    if (sha[:9], new) in ALLOWED:
                        notes.append(f"allowed rewiring: {new}")
                    else:
                        failures.append(f"{sha[:9]} changes {new} beyond the moved module path")
            else:
                b, a = show(f"{sha}^", old), show(sha, new)
                if b is None or a is None or norm_text(b) != norm_text(a):
                    failures.append(f"{sha[:9]} changes {new} beyond the moved module path")
        lost, gained = app_before - app_after, app_after - app_before
        for d in list(lost)[:3] + list(gained)[:3]:
            failures.append(f"{sha[:9]} app code not pure motion: {d[:160]}")
        print(f"{sha[:9]} units={sum(app_after.values()):4d} lost={sum(lost.values())} "
              f"gained={sum(gained.values())} {'; '.join(notes)}  {subj}")
    if "helpers to services/analytics.py" not in moves[-1][1]:
        failures.append(f"the last Move commit is not the analytics service extraction: {moves[-1][1]}")

if failures:
    print("FAIL:\n  " + "\n  ".join(failures))
    sys.exit(1)
print(f"OK {mode}")
PY
