import { useState, useEffect, useRef } from 'react';
import { ListChecks, Check, ChevronRight, ChevronDown, HelpCircle } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { useEditorStore } from '../stores/editorStore';
import { useAuthStore } from '../stores/authStore';
import { STEP_TITLES, STEP_DESCRIPTIONS, WatchTutorialButton, TUTORIAL_STEP_QUEST, TUTORIAL_VIDEOS_ENABLED } from '../config/questDefinitions.jsx';
import { Z } from '../constants/zLayers';
import { toast } from './shared/Toast';
import { isAnyModalOpen } from '../utils/modalOcclusion';

import exportWebSocketManager from '../services/ExportWebSocketManager';

/** T8690: quest step_ids to render — with tutorial videos disabled, the four
 *  `watch_*_tutorial` steps are filtered out so every downstream derivation
 *  (checklist rows, current-step highlight, x/N counters, completion fanfare)
 *  reads cleanly. Returns the original array when the flag is on. */
const visibleStepIdsFor = (stepIds) =>
  TUTORIAL_VIDEOS_ENABLED
    ? stepIds
    : stepIds.filter((sid) => !TUTORIAL_STEP_QUEST[sid]);

/**
 * T8120 occlusion contract: the quest/help surface may NEVER overlap an open
 * modal/form/dialog. Wraps isAnyModalOpen() (utils/modalOcclusion.js) as a
 * subscribable hook so the panel can auto-hide fully while one is present.
 * z-order (panel below Z.MODAL) is the defense-in-depth backstop; this is
 * the primary "hide it entirely" mechanism. A MutationObserver re-checks on
 * mount/unmount of any subtree, not a poll.
 */
function useModalOcclusion() {
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    const check = () => setModalOpen(isAnyModalOpen());
    // T8120 perf: MutationObserver fires on every class/style mutation anywhere
    // in the body (e.g. TimelineBase's scrub-thumb style updates during playback,
    // up to ~60x/sec), and check() forces layout via getClientRects(). Coalesce
    // bursts of mutations behind rAF so at most one layout-forcing check runs
    // per animation frame instead of one per mutation.
    let rafId = null;
    const scheduleCheck = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        check();
      });
    };
    check();
    const obs = new MutationObserver(scheduleCheck);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    return () => {
      obs.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);
  return modalOpen;
}

/**
 * T1030: Per-mode position config for the quest panel.
 * Instead of auto-collapsing when overlapping controls, the panel
 * repositions to empty screen space depending on the current editor mode.
 *
 * - Home/Projects: default bottom-left (no overlap issues)
 * - Annotate: anchored above the clip details section (measured dynamically)
 * - Framing: moved up above the timeline/scrub bar region
 * - Overlay: same as framing (similar bottom layout)
 */
function getPositionForMode(editorMode, isSm, addClipFormOpen) {
  if (!isSm) return { left: 12, bottom: 12 }; // Mobile: always bottom-left, compact

  // Annotate: the Add Clip form opens in the left-docked sidebar (352px wide) and
  // would cover the default bottom-left panel. Move to the right side (clear of the
  // form) and lift above the timeline/action-bar instead of hiding the quest.
  if (editorMode === 'annotate' && addClipFormOpen) {
    return { right: 24, bottom: 220 };
  }

  switch (editorMode) {
    case 'framing':
    case 'overlay':
      return { left: 24, bottom: 220 };
    default:
      return { left: 24, bottom: 40 };
  }
}

/**
 * QuestPanel — self-contained floating overlay with collapsed/expanded states (T540).
 *
 * Collapsed: icon + quest title + progress (e.g., "Get Started  2/5")
 * Expanded: full step checklist + reward
 *
 * No header button needed — this component handles its own visibility,
 * fetching, and event subscriptions.
 */
export function QuestPanel({ inline = false }) {
  const definitions = useQuestStore((s) => s.definitions);
  const quests = useQuestStore((s) => s.quests);
  const loaded = useQuestStore((s) => s.loaded);
  const activeQuestId = useQuestStore((s) => s.activeQuestId);
  const fetchProgress = useQuestStore((s) => s.fetchProgress);
  const detectionAssignProgress = useQuestStore((s) => s.detectionAssignProgress);
  // T7840: opener for the `upload_game` step, registered by the mounted
  // ProjectManager. When present, that current step renders as a real button.
  const addGameOpener = useQuestStore((s) => s.addGameOpener);

  const claimReward = useQuestStore((s) => s.claimReward);
  // T8120: collapsed/expanded is a PERSISTED user preference (survives navigation
  // + reload), gesture-written on the toggle click. The store is the single
  // source of truth — the old per-mount `useState(true)` reset to expanded on
  // every screen navigation (the reported "re-expands itself" bug) and could not
  // survive reload. Never auto-re-expands once collapsed.
  const panelCollapsed = useQuestStore((s) => s.panelCollapsed);
  const collapsePanel = useQuestStore((s) => s.collapsePanel);

  const [hidden, setHidden] = useState(false);       // User fully dismissed
  const [claiming, setClaiming] = useState(false);
  const [celebrating, setCelebrating] = useState(false);  // Quest complete celebration
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const prevCompletedRef = useRef(null);  // Track step count to detect new completions
  const panelRef = useRef(null);

  // T8120: auto-hide fully whenever any modal/dialog is open (occlusion contract).
  const modalOpen = useModalOcclusion();

  // T1030: Read editorMode for smart repositioning (replaces auto-collapse)
  const editorMode = useEditorStore((s) => s.editorMode);
  const isExpanded = !panelCollapsed;

  const [addClipFormOpen, setAddClipFormOpen] = useState(false);
  useEffect(() => {
    if (editorMode !== 'annotate') {
      setAddClipFormOpen(false);
      return;
    }
    const measure = () => {
      setAddClipFormOpen(!!document.querySelector('[data-add-clip-form]'));
    };
    const timer = setTimeout(measure, 100);
    const interval = setInterval(measure, 500);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [editorMode]);

  // Play sound effects
  const playSound = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'check') {
        // Quick bright ping for step completion
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'fanfare') {
        // Celebratory ascending arpeggio for quest completion
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        osc.frequency.setValueAtTime(523, ctx.currentTime);         // C5
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.12);  // E5
        osc.frequency.setValueAtTime(784, ctx.currentTime + 0.24);  // G5
        osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.36); // C6
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch {
      // Audio not available — no-op
    }
  };

  // T635: Quest progress is fetched centrally in App.jsx after auth resolves.
  // No need to fetch on mount here — the store is already populated.

  // Subscribe to export events to refresh quest progress
  // Listen for 'progress' (job created → framing-export step) and 'complete' (job done → wait-for-export step)
  useEffect(() => {
    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', fetchProgress);
    const unsubProgress = exportWebSocketManager.addEventListener('*', 'progress', fetchProgress);
    return () => { unsubComplete(); unsubProgress(); };
  }, [fetchProgress]);

  // Detect step completions and quest completions for audio/animation
  const questDef = definitions?.find(q => q.id === activeQuestId) || definitions?.[0];
  // T8690: render/count only the visible steps (tutorial steps filtered when the
  // flag is off) so every derivation below stays consistent — a hidden step's
  // backend completion boolean must not inflate counts or the fanfare trigger.
  const visibleStepIds = questDef ? visibleStepIdsFor(questDef.step_ids) : [];
  const questProgress = quests.find(q => q.id === activeQuestId);
  const currentCompleted = questProgress
    ? visibleStepIds.filter((sid) => questProgress.steps[sid]).length
    : 0;

  useEffect(() => {
    if (!questDef) return;
    if (prevCompletedRef.current === null) {
      // First load — just record, don't play sound
      prevCompletedRef.current = currentCompleted;
      return;
    }
    if (currentCompleted > prevCompletedRef.current) {
      const questStepCount = visibleStepIds.length;
      if (currentCompleted === questStepCount && !questProgress?.reward_claimed) {
        // All steps done — fanfare + celebration animation. T8120: do NOT
        // auto-expand — a collapsed panel stays collapsed (never auto-re-expands
        // after the user collapses it); the celebration plays only when open.
        playSound('fanfare');
        setCelebrating(true);
      } else {
        // Individual step completed
        playSound('check');
      }
    }
    prevCompletedRef.current = currentCompleted;
  }, [currentCompleted]);  // eslint-disable-line react-hooks/exhaustive-deps

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const isSharedAnnotationFlow = sessionStorage.getItem('shared_annotation_flow') === 'true';

  // Don't render if hidden, not loaded, definitions not fetched, or all quests done
  const allQuestsDone = loaded && quests.length > 0 && quests.every(q => q.reward_claimed);
  // On mobile the Add Clip form is a full-screen takeover, so hide the quest there.
  // On desktop the form is a left-docked sidebar — keep the quest visible and
  // reposition it (see getPositionForMode) instead of hiding it.
  const hideForAddClipForm = addClipFormOpen && window.innerWidth < 640;
  // T8120: auto-hide fully whenever any modal/dialog is open (occlusion contract).
  // Excludes the panel's own completion modal (showCompletionModal), which is a
  // celebration the user just triggered and should stay up.
  if ((hidden || !loaded || !definitions || !questDef || hideForAddClipForm || modalOpen || isSharedAnnotationFlow || (isAuthenticated && allQuestsDone)) && !showCompletionModal) {
    return null;
  }
  const steps = questProgress?.steps || {};
  const completedCount = visibleStepIds.filter((sid) => steps[sid]).length;
  const totalCount = visibleStepIds.length;
  const isComplete = completedCount === totalCount;
  const currentStepId = visibleStepIds.find(sid => !steps[sid]);

  const handleClaimReward = async () => {
    setClaiming(true);
    setCelebrating(false);
    try {
      const result = await claimReward(questDef.id);
      if (!result.already_claimed) {
        playSound('fanfare');
        if (questDef.id === 'quest_4') {
          setShowCompletionModal(true);
        } else {
          // T8120: credits are granted upfront, not per quest — celebrate the
          // milestone without a credit claim message.
          toast.success('Quest complete!', {
            message: 'Keep going — more quests await!',
            duration: 6000,
          });
        }
      }
    } catch (err) {
      toast.error('Something went wrong', { message: err.message });
    } finally {
      setClaiming(false);
    }
  };

  // T1030: Smart repositioning — pick position per screen mode to avoid overlapping controls
  const isSm = window.innerWidth >= 640;
  // T1600: On home screen (inline), the panel flows after the page content, so no
  // positioning offset is applied — `relative` (unlike `static`) still honors
  // top/left/bottom/right, and applying the fixed-overlay offsets here made it
  // ride up over the content above it (e.g. the games list) instead of flowing below it.
  const positionStyle = inline ? undefined : getPositionForMode(editorMode, isSm, addClipFormOpen);

  return (
    <>
    {/* Final-quest completion modal — rendered outside quest panel to ensure centering */}
    {showCompletionModal && (
      <div data-quest-panel className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
        <div className="bg-gray-800 border border-gray-600 rounded-2xl p-6 sm:p-12 max-w-2xl mx-4 shadow-2xl">
          <div className="text-center mb-6 sm:mb-10">
            <div className="text-4xl sm:text-6xl mb-3 sm:mb-5">🎉</div>
            <h2 className="text-2xl sm:text-4xl font-bold text-white mb-2 sm:mb-3">Congratulations!</h2>
            <p className="text-green-400 font-semibold text-xl sm:text-2xl">You published your first reel</p>
          </div>
          <div className="space-y-3 sm:space-y-5 text-gray-300 text-base sm:text-xl leading-relaxed">
            <p>Annotate every touch so your baller can take their game to the next level.</p>
            <p>Extract highlights anytime to post to Insta or send to college coaches.</p>
            <p className="text-white font-medium">Use your credits to put the focus on more highlights!</p>
          </div>
          <button
            onClick={() => setShowCompletionModal(false)}
            className="mt-6 sm:mt-10 w-full py-3 sm:py-4 bg-green-600 hover:bg-green-500 text-white font-bold text-lg sm:text-xl rounded-xl transition-colors"
          >
            Vamos!
          </button>
        </div>
      </div>
    )}
    {!allQuestsDone && !isExpanded && (
      /* T8120: collapsed presentation is a small "Help" chip — the low-profile
         resting state. Clicking it is the gesture that re-expands the panel.
         Sits below Z.MODAL (defense in depth) and never overlaps a modal. */
      <div
        ref={panelRef}
        data-quest-panel
        className={`quest-overlay ${inline ? 'relative mx-3' : 'fixed'} ${Z.DROPDOWN} quest-fade-in`}
        style={positionStyle}
      >
        <button
          type="button"
          onClick={() => collapsePanel(false)}
          aria-label="Open onboarding help"
          className="quest-card flex items-center gap-2 rounded-full pl-2.5 pr-3 py-2 hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          <div className="quest-icon-badge rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
            <HelpCircle size={14} className="text-white" />
          </div>
          <span className="quest-title text-sm leading-none">Help</span>
          <span className="quest-progress-text text-xs tabular-nums flex-shrink-0">
            {completedCount}/{totalCount}
          </span>
        </button>
      </div>
    )}
    {!allQuestsDone && isExpanded && (
    <div
      ref={panelRef}
      data-quest-panel
      className={`quest-overlay ${inline ? 'relative mx-3 pt-6 pb-6' : 'fixed'} ${Z.DROPDOWN} quest-fade-in transition-all duration-300 sm:w-[340px] sm:max-w-[calc(100vw-2rem)]`}
      style={positionStyle}
    >
      <div className={`quest-card rounded-2xl overflow-hidden ${celebrating ? 'quest-celebrate' : ''}`}>
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 quest-accent-bar rounded-t-2xl" />

        {/* Header — clickable to collapse back to the Help chip */}
        <button
          onClick={() => collapsePanel(true)}
          aria-label="Collapse to Help button"
          className="w-full flex items-center text-left hover:bg-white/[0.02] transition-colors gap-3 px-4 pt-4 pb-3"
        >
          <div className="quest-icon-badge rounded-lg flex items-center justify-center flex-shrink-0 w-7 h-7">
            <ListChecks size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="quest-title leading-tight text-sm">{questDef.title}</h3>
              <span className="quest-progress-text text-xs tabular-nums flex-shrink-0 ml-auto">
                {completedCount}/{totalCount}
              </span>
            </div>
          </div>
          <ChevronDown size={16} className="text-white/30 flex-shrink-0" />
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <>


            {/* Steps */}
            <div className="px-4 pb-2">
              {visibleStepIds.map((stepId, index) => {
                const done = steps[stepId] || false;
                const isCurrent = stepId === currentStepId;
                // T7840: a current step is actionable only when its owning surface
                // registered a gesture opener for it — today just `upload_game`
                // (ProjectManager wires handleAddGameClick). Actionable rows render
                // as a real button and show the chevron; every other current step
                // (tutorial steps carry their own embedded CTA, and the floating
                // editor panel never registers the opener) keeps the plain,
                // chevron-less div so there is no false "tap me" affordance.
                const stepOpener = isCurrent && !done && stepId === 'upload_game' ? addGameOpener : null;
                const actionable = Boolean(stepOpener);
                const RowTag = actionable ? 'button' : 'div';

                return (
                  <RowTag
                    key={stepId}
                    type={actionable ? 'button' : undefined}
                    onClick={actionable ? stepOpener : undefined}
                    className={`
                      ${isCurrent ? 'flex' : 'hidden sm:flex'} items-start gap-3.5 py-3
                      ${actionable ? 'w-full text-left cursor-pointer hover:bg-white/[0.02] transition-colors' : ''}
                      ${index < visibleStepIds.length - 1 ? 'sm:border-b border-white/5' : ''}
                      ${isCurrent ? 'quest-step-current' : ''}
                    `}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {done ? (
                        <div className="quest-check-done w-6 h-6 rounded-lg quest-check-bg flex items-center justify-center">
                          <Check size={14} className="text-white" strokeWidth={3} />
                        </div>
                      ) : isCurrent ? (
                        <div className="w-6 h-6 rounded-lg border-2 quest-current-border quest-pulse" />
                      ) : (
                        <div className="w-6 h-6 rounded-lg border-2 border-white/10" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className={`leading-tight ${
                        done ? 'quest-step-done text-base' :
                        isCurrent ? 'quest-step-active text-base' :
                        'quest-step-inactive text-base'
                      }`}>
                        {STEP_TITLES[stepId] || stepId}
                      </p>
                      {isCurrent && (
                        <p className="quest-step-description text-sm mt-1 leading-snug">
                          {STEP_DESCRIPTIONS[stepId]}
                        </p>
                      )}
                      {/* T8120: tutorial videos stay REACHABLE from the expanded
                          panel but are never a PUSHED CTA — the old pulsing
                          `variant="primary"` button drove accidental tutorial
                          watches (watched_annotate_tutorial 15 vs 3 who clipped).
                          Downgraded to the low-key inline pill for the current
                          tutorial step. */}
                      {isCurrent && !done && TUTORIAL_STEP_QUEST[stepId] && (
                        <div className="mt-2">
                          <WatchTutorialButton questId={TUTORIAL_STEP_QUEST[stepId]} label="Watch tutorial" />
                        </div>
                      )}
                      {/* Tutorial steps stay relaunchable even after completion */}
                      {done && TUTORIAL_STEP_QUEST[stepId] && (
                        <div className="mt-1">
                          <WatchTutorialButton questId={TUTORIAL_STEP_QUEST[stepId]} label="Watch again" />
                        </div>
                      )}
                      {/* Per-detection progress: one box per detected frame, ordered left-to-right
                          to match the timeline markers so a gap shows which one was missed. */}
                      {isCurrent && stepId === 'select_players' && detectionAssignProgress?.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {detectionAssignProgress.map((filled, i) => (
                            <div
                              key={i}
                              className={`w-5 h-5 rounded flex items-center justify-center border ${
                                filled ? 'bg-green-500 border-green-300' : 'border-white/20'
                              }`}
                            >
                              {filled && <Check size={12} className="text-white" strokeWidth={3} />}
                            </div>
                          ))}
                          <span className="ml-1 text-xs quest-step-description tabular-nums">
                            {detectionAssignProgress.filter(Boolean).length}/{detectionAssignProgress.length}
                          </span>
                        </div>
                      )}
                    </div>

                    {actionable && (
                      <ChevronRight size={16} className="quest-chevron flex-shrink-0 mt-0.5" />
                    )}
                  </RowTag>
                );
              })}
            </div>

            {/* Continue button — only shown when quest is complete. T8120: credits
                are granted upfront, so this no longer claims a reward — it just
                acknowledges the milestone and advances the panel to the next quest. */}
            {isComplete && (
              <div className="px-4 pb-4 pt-1">
                <button
                  onClick={handleClaimReward}
                  disabled={claiming}
                  className="quest-claim-btn quest-claim-pulse w-full flex items-center justify-center gap-2 py-3 rounded-xl
                    disabled:opacity-50 disabled:cursor-not-allowed
                    text-white font-bold text-base
                    transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Check size={18} strokeWidth={3} />
                  {claiming ? 'Saving...' : 'Continue'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

    </div>
    )}
    </>
  );
}

export default QuestPanel;
