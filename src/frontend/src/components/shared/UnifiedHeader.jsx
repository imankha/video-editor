import { Home, ChevronRight, ArrowLeft } from 'lucide-react';
import { Breadcrumb } from './Breadcrumb';
import { Button } from './Button';
import { ModeSwitcher } from './ModeSwitcher';
import { CreditBalance } from '../CreditBalance';
import { SignInButton } from '../SignInButton';
import { InstallButton } from '../InstallButton';
import { useIsMobile } from '../../hooks/useIsMobile';

/**
 * UnifiedHeader - Shared header across all editor modes
 *
 * Desktop (>=1024px): Home button + breadcrumb (left), CreditBalance/SignIn/ModeSwitcher (right)
 * Compact (<1024px): two rows below `md` (768px), one row at `md`+ (T11740). Row 1 is
 *   Back + title block (+ game name second line on Focus/Spotlight) + chips; row 2 is the
 *   ModeSwitcher. The row split is pure Tailwind `md:` (NOT useIsMobile, which sends
 *   768-1023 tablets to the compact branch where they still fit one row).
 */
export function UnifiedHeader({
  onHomeClick,
  breadcrumbType,
  breadcrumbGameName,
  onGameNameClick,
  breadcrumbItemName,
  breadcrumbItemMeta,
  editorMode,
  onModeChange,
  hasProject = false,
  hasSelectedPlay = true,
  hasWorkingVideo = false,
  modeProject,
  hasOverlayVideo = false,
  framingOutOfSync = false,
  hasAnnotateVideo = false,
  isLoadingWorkingVideo = false,
  extraControls,
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div
        data-testid="editor-header"
        // pr-1 below md: the framed-clip badge (FramingHeaderStatus -> Disc DONE) has a
        // decorative check that overhangs its corner by ~4px (absolute -right-1). With the
        // chips pinned right, that overhang would poke past the header/viewport on a phone;
        // the 4px right pad keeps it inside. md:pr-0 -> desktop/768 spacing unchanged.
        className="flex flex-col gap-1 mb-2 pr-1 md:flex-row md:items-center md:gap-2 md:pr-0"
      >
        {/* Row 1: back + title block + chips */}
        <div className="flex items-start gap-2 min-h-11 md:flex-1 md:min-w-0">
          <button
            onClick={onHomeClick}
            className="flex items-center justify-center w-11 h-11 text-gray-400 hover:text-white transition-colors flex-shrink-0"
            title="Back"
          >
            <ArrowLeft size={20} />
          </button>
          {/* Below md the title sizes to content and only shrinks (min-w-0) under
              pressure; it does NOT flex-grow. A growing title rounds up and steals a
              couple px from the flex-shrink-0 chips, overflowing the Focus header on a
              390px row. ml-auto keeps the chips pinned right. At md+ the one-row header
              restores today's grow-the-title / no-auto-margin layout (768 unchanged). */}
          <div className="min-w-0 py-1 md:flex-1">
            <div
              data-testid="editor-header-title"
              className="text-white font-medium text-sm leading-tight line-clamp-2 break-words"
            >
              {breadcrumbItemName || breadcrumbType}
            </div>
            {/* Focus/Spotlight carry a game name; Annotate's title IS the game name. */}
            {breadcrumbGameName && (
              <div className="text-xs text-gray-400 truncate">{breadcrumbGameName}</div>
            )}
          </div>
          {/* gap-0 below md: the chips (CreditBalance, FramingHeaderStatus) carry their
              own `ml-2`, so the container gap would double it. At md+ gap-2 returns. */}
          <div className="flex items-center gap-0 md:gap-2 flex-shrink-0 self-center ml-auto md:ml-0">
            {editorMode === 'framing' && <CreditBalance />}
            {extraControls}
          </div>
        </div>
        {/* Row 2: editor-step tabs */}
        <div
          role="group"
          aria-label="Editor steps"
          className="grid grid-cols-3 gap-1 bg-white/5 rounded-lg p-1 md:flex md:bg-transparent md:p-0"
        >
          <ModeSwitcher
            mode={editorMode}
            onModeChange={onModeChange}
            hasProject={hasProject}
            hasSelectedPlay={hasSelectedPlay}
            hasWorkingVideo={hasWorkingVideo}
            project={modeProject}
            hasOverlayVideo={hasOverlayVideo}
            framingOutOfSync={framingOutOfSync}
            hasAnnotateVideo={hasAnnotateVideo}
            isLoadingWorkingVideo={isLoadingWorkingVideo}
            inline
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row items-center justify-between gap-0 mb-8">
      <div className="flex items-center gap-4 min-w-0">
        <Button
          variant="ghost"
          icon={Home}
          iconOnly
          onClick={onHomeClick}
          title="Home"
        />
        <ChevronRight className="w-4 h-4 text-gray-600" />
        <div className="min-w-0">
          <Breadcrumb
            type={breadcrumbType}
            gameName={breadcrumbGameName}
            onGameClick={onGameNameClick}
            itemName={breadcrumbItemName}
            itemMeta={breadcrumbItemMeta}
            onTypeClick={onHomeClick}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {extraControls}
        <InstallButton />
        <div className="hidden lg:block"><CreditBalance /></div>
        <SignInButton />
        <ModeSwitcher
          mode={editorMode}
          onModeChange={onModeChange}
          hasProject={hasProject}
          hasSelectedPlay={hasSelectedPlay}
          hasWorkingVideo={hasWorkingVideo}
          project={modeProject}
          hasOverlayVideo={hasOverlayVideo}
          framingOutOfSync={framingOutOfSync}
          hasAnnotateVideo={hasAnnotateVideo}
          isLoadingWorkingVideo={isLoadingWorkingVideo}
        />
      </div>
    </div>
  );
}

export default UnifiedHeader;
