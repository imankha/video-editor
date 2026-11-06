import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { RagChip } from './RagChip';
import { Toggle } from './Toggle';
import { END_TO_END_KEY, JOURNEY_TARGETS, RAG_STYLES, journeyTransitions, transitionChipText } from './journeyTargets';

// T14920: what to do next. Three read-only payloads side by side: the Journey map (T14900
// colours every step), the spend-readiness payload (T14910 verdict and focus gate) and the
// build-time roadmap export (public/roadmap.json: PLAN.md's board rows plus the stage map in
// docs/plans/roadmap-stage-map.json). Nothing here is recomputed from PLAN.md at runtime and
// nothing persists; the roadmap is as fresh as the deployed build and says so in its header.
// Design: docs/plans/tasks/T14920-design.md.

// Task files live on the repo's default branch; the deployed admin has no task board.
export const REPO_FILE_BASE = 'https://github.com/imankha/video-editor/blob/master/';
// The nine steps of the roadmap, in funnel order (the end-to-end step is a summary, not a step).
export const STEP_KEYS = Object.keys(JOURNEY_TARGETS).filter(k => k !== END_TO_END_KEY);
// A step is "below target" when T14900 colours it red or yellow; grey (under the floor) and
// partial (instrumentation gap) steps have no verdict and never become the biggest leak.
const LEAK_RAGS = ['red', 'yellow'];
// Statuses a task can still be worked from: the first of these in a list is "Next". Staging and
// done are shipped; other (SUPERSEDED, OBSOLETE, ICE, DECIDED) is not work.
const ACTIONABLE_KINDS = ['todo', 'wip', 'waiting', 'blocked'];
// The task board's badge colours (scripts/task-manager.py .badge-*), so the two tools agree.
const KIND_CHIP = {
  todo: 'bg-sky-500/15 text-sky-300',
  wip: 'bg-blue-500/20 text-blue-300 border border-blue-400/60',
  waiting: 'bg-purple-500/20 text-purple-300',
  blocked: 'bg-red-500/15 text-red-300',
  staging: 'bg-orange-500/20 text-orange-300',
  done: 'bg-green-500/15 text-green-300',
  other: 'bg-gray-500/15 text-gray-400',
};

export const usersLost = t => t.n - t.k;

// The red or yellow step that lost the most judged users; ties keep the earlier step, which
// is how PLAN.md orders its sections. Null when no step is red or yellow.
export function biggestLeak(transitions) {
  let best = null;
  for (const t of transitions) {
    if (!LEAK_RAGS.includes(t.rag)) continue;
    if (!best || usersLost(t) > usersLost(best)) best = t;
  }
  return best;
}

export function nextTask(ids, tasks) {
  return ids.find(id => tasks[id] && ACTIONABLE_KINDS.includes(tasks[id].kind)) || null;
}

function asOf(generatedAt) {
  const d = new Date(generatedAt);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function TaskStatusChip({ task }) {
  return (
    <span data-testid="task-status-chip" data-kind={task.kind}
          className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-px rounded ${KIND_CHIP[task.kind]}`}>
      {task.status}
    </span>
  );
}

function Loud({ testId, children, tone = 'amber' }) {
  return (
    <div data-testid={testId} className={`text-xs ${tone === 'red' ? 'text-red-400' : 'text-amber-400'}`}>
      &#9888; {children}
    </div>
  );
}

// The mapped tasks of one step or gate, in roadmap order, the first actionable one marked Next.
function TaskList({ ids, tasks, testId, dataKey, note }) {
  const next = nextTask(ids, tasks);
  return (
    <div data-testid={testId} data-key={dataKey} className="min-w-0">
      {note && <div className="text-[11px] text-gray-500 mb-0.5">{note}</div>}
      {ids.length > 0 && (
        <ul className="space-y-0.5">
          {ids.map(id => {
            const task = tasks[id];
            return (
              <li key={id} data-testid={`next-step-task-${id}`} data-task={id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                {task ? (
                  <>
                    <a href={`${REPO_FILE_BASE}${task.file}`} target="_blank" rel="noreferrer"
                       className="font-mono text-purple-300 hover:underline">{id}</a>
                    <span className="text-gray-200 min-w-0">{task.title}</span>
                    <TaskStatusChip task={task} />
                    {id === next && <span data-testid="next-step-next" className="text-[10px] font-semibold uppercase text-purple-300">Next</span>}
                  </>
                ) : (
                  <>
                    <span className="font-mono text-purple-300">{id}</span>
                    <span className="text-red-400">no board row in the roadmap export</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {next === null && (
        <Loud testId="next-step-nothing-planned">
          {ids.length === 0 ? 'nothing planned for this step' : 'nothing planned for this step: every mapped task is shipped or retired'}
        </Loud>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div data-testid="next-step-row" className="grid grid-cols-1 md:grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1 py-2 border-t border-white/5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 pt-0.5">{label}</div>
      <div className="min-w-0 text-xs text-gray-300">{children}</div>
    </div>
  );
}

// Which step "Do next" describes: the leak, or (nothing below target) the first step with work.
const isJudged = t => ['red', 'yellow', 'green'].includes(t.rag);

function doNextKey(leak, transitions, roadmap) {
  if (leak) return { key: leak.key, note: null };
  const planned = roadmap && transitions.find(t => (roadmap.transitions[t.key] || []).length > 0);
  const t = planned || transitions[0];
  const judged = transitions.filter(isJudged).length;
  const why = judged === 0 ? 'no step could be judged'
    : judged < transitions.length ? 'no judged step is below target' : 'no step is below target';
  return t ? { key: t.key, note: `first step with planned work (${why})` } : null;
}

function LeakRow({ journey, transitions, leak }) {
  if (!journey) return <div data-testid="next-step-leak">Loading journey...</div>;
  const judged = transitions.filter(isJudged).length;
  const unjudged = transitions.filter(t => !isJudged(t)).map(t => `${t.label} (${RAG_STYLES[t.rag].word})`);
  if (!leak) {
    return (
      <div data-testid="next-step-leak">
        {judged === 0 ? 'No step could be judged.' : `No step below target among the ${judged} judged steps.`}
        {unjudged.length > 0 && <span className="text-gray-500"> Not judged: {unjudged.join(', ')}.</span>}
      </div>
    );
  }
  return (
    <div data-testid="next-step-leak" data-key={leak.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-white font-medium">{leak.label}</span>
      <RagChip testId="next-step-leak-chip" rag={leak.rag} text={transitionChipText(leak)} title={RAG_STYLES[leak.rag].word} />
      <span className="text-white font-semibold">{usersLost(leak)} lost</span>
      {unjudged.length > 0 && <span className="text-gray-500">Not judged: {unjudged.join(', ')}. Any of these could be larger.</span>}
    </div>
  );
}

function stepLabel(key, transitions, journey) {
  const t = transitions.find(x => x.key === key);
  if (t) return t.label;
  const { from, to } = JOURNEY_TARGETS[key];
  const name = k => (journey && journey.nodes.find(n => n.key === k)) ? journey.nodes.find(n => n.key === k).label : k;
  return `${name(from)} to ${name(to)}`;
}

function Roadmap({ roadmap, transitions, journey }) {
  const [open, setOpen] = useState(false);
  const taskCount = new Set(STEP_KEYS.flatMap(k => roadmap.transitions[k] || [])).size;
  return (
    <>
      <Toggle testId="next-step-roadmap-toggle" open={open} onClick={() => setOpen(o => !o)} className="text-gray-300">
        <span>{STEP_KEYS.length} steps, {taskCount} tasks</span>
        {!open && <span className="text-gray-500 ml-2">every step in funnel order with its tasks</span>}
      </Toggle>
      {open && (
        <ol data-testid="next-step-roadmap" className="mt-2 space-y-2">
          {STEP_KEYS.map(key => (
            <li key={key} data-testid={`next-step-roadmap-step-${key}`} data-key={key} className="grid grid-cols-1 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-4 gap-y-0.5">
              <span className="text-gray-400">{stepLabel(key, transitions, journey)}</span>
              {roadmap.transitions[key]
                ? <TaskList ids={roadmap.transitions[key]} tasks={roadmap.tasks} />
                : <Loud tone="red">roadmap has no entry for {key}</Loud>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function SpendRow({ spend, spendLoading, spendError, roadmap }) {
  let line;
  if (spend) line = spend.verdict.line;
  else if (spendLoading) line = 'Loading spend readiness...';
  else if (spendError) line = `Spend readiness failed to load: ${spendError}`;
  else line = 'Spend readiness not loaded.';
  const focus = spend && spend.focus;
  return (
    <div className="space-y-1">
      <div data-testid="next-step-spend-line" className={spend ? '' : 'text-gray-500'}>{line}</div>
      {focus && (
        <div data-testid="next-step-focus" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-gray-500">focus {focus.tier},</span>
          <span className="text-white">{focus.label}</span>
          <RagChip testId="next-step-focus-chip" rag={focus.rag} text={focus.rag} title={`the ${focus.tier} gate to clear first`} />
        </div>
      )}
      {focus && roadmap && (
        roadmap.gates[focus.gate]
          ? <TaskList ids={roadmap.gates[focus.gate]} tasks={roadmap.tasks} testId="next-step-focus-tasks" dataKey={focus.gate} />
          : <Loud testId="next-step-no-entry" tone="red">roadmap has no entry for gate {focus.gate}</Loud>
      )}
    </div>
  );
}

export function NextStepPanel({ roadmap, roadmapLoading, roadmapError, journey, spend, spendLoading, spendError, onRefresh }) {
  const transitions = journey ? journeyTransitions(journey.nodes) : [];
  const leak = journey ? biggestLeak(transitions) : null;
  const doNext = journey ? doNextKey(leak, transitions, roadmap) : null;
  return (
    <div data-testid="next-step" className="mb-5 bg-white/5 rounded-lg border border-white/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2 pb-1">
        <span className="text-xs uppercase tracking-wider text-gray-300">Next step</span>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          {roadmap && <span data-testid="next-step-asof">roadmap as of {asOf(roadmap.generated_at)}, {roadmap.commit}</span>}
          <button type="button" onClick={onRefresh} aria-label="Refresh roadmap" title="Re-read the roadmap export"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/10 hover:border-white/20 text-gray-400 hover:text-gray-300">
            <RefreshCw size={11} aria-hidden="true" className={roadmapLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {!roadmap && (
        <Loud testId="next-step-missing">
          {roadmapLoading
            ? 'Loading roadmap...'
            : <>roadmap export missing{roadmapError ? ` (${roadmapError})` : ''}: run <code>npm run roadmap</code> in src/frontend (the build and the dev server run it; PLAN.md must parse).</>}
        </Loud>
      )}

      <Row label={transitions.every(isJudged) ? 'Biggest leak' : 'Biggest judged leak'}>
        <LeakRow journey={journey} transitions={transitions} leak={leak} />
      </Row>

      {roadmap && doNext && (
        <Row label="Do next">
          {roadmap.transitions[doNext.key]
            ? <TaskList ids={roadmap.transitions[doNext.key]} tasks={roadmap.tasks} testId="next-step-tasks" dataKey={doNext.key} note={doNext.note} />
            : <Loud testId="next-step-no-entry" tone="red">roadmap has no entry for {doNext.key}</Loud>}
        </Row>
      )}

      <Row label="Spend">
        <SpendRow spend={spend} spendLoading={spendLoading} spendError={spendError} roadmap={roadmap} />
      </Row>

      {roadmap && (
        <Row label="Roadmap">
          <Roadmap roadmap={roadmap} transitions={transitions} journey={journey} />
        </Row>
      )}
    </div>
  );
}
