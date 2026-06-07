import { Home, ChevronRight, ArrowLeft, Scissors, Crop, Sparkles } from 'lucide-react';
import { Breadcrumb } from './Breadcrumb';
import { Button } from './Button';
import { ModeSwitcher } from './ModeSwitcher';
import { CreditBalance } from '../CreditBalance';
import { SignInButton } from '../SignInButton';
import { InstallButton } from '../InstallButton';
import { useIsMobile } from '../../hooks/useIsMobile';

const MODE_ICONS = {
  annotate: Scissors,
  framing: Crop,
  overlay: Sparkles,
};

/**
 * UnifiedHeader - Shared header across all editor modes
 *
 * Desktop: Home button + breadcrumb (left), CreditBalance/SignIn/ModeSwitcher (right)
 * Mobile: Back arrow + truncated title + mode indicator icon
 */
export function UnifiedHeader({
  onHomeClick,
  breadcrumbType,
  breadcrumbItemName,
  editorMode,
  onModeChange,
  hasProject = false,
  hasWorkingVideo = false,
  hasOverlayVideo = false,
  framingOutOfSync = false,
  hasAnnotateVideo = false,
  isLoadingWorkingVideo = false,
  extraControls,
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    const ModeIcon = MODE_ICONS[editorMode] || Scissors;
    return (
      <div className="flex items-center gap-2 mb-2 h-10">
        <button
          onClick={onHomeClick}
          className="flex items-center justify-center w-10 h-10 text-gray-400 hover:text-white transition-colors flex-shrink-0"
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="text-white font-medium text-sm truncate flex-1 min-w-0">
          {breadcrumbItemName || breadcrumbType}
        </span>
        {editorMode === 'framing' && <CreditBalance />}
        {extraControls}
        <ModeSwitcher
          mode={editorMode}
          onModeChange={onModeChange}
          hasProject={hasProject}
          hasWorkingVideo={hasWorkingVideo}
          hasOverlayVideo={hasOverlayVideo}
          framingOutOfSync={framingOutOfSync}
          hasAnnotateVideo={hasAnnotateVideo}
          isLoadingWorkingVideo={isLoadingWorkingVideo}
          inline
        />
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
            itemName={breadcrumbItemName}
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
          hasWorkingVideo={hasWorkingVideo}
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
