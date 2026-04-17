import { Home, ShieldCheck } from 'lucide-react';
import { Breadcrumb } from './Breadcrumb';
import { Button } from './Button';
import { ModeSwitcher } from './ModeSwitcher';
import { CreditBalance } from '../CreditBalance';
import { GalleryButton } from '../GalleryButton';
import { SignInButton } from '../SignInButton';

/**
 * UnifiedHeader - Shared header across all editor modes
 *
 * Contains:
 * - Home button + clickable breadcrumb (left)
 * - CreditBalance, Gallery, SignIn, Admin, ModeSwitcher (right)
 *
 * @param {function} onHomeClick - Navigate back to home/projects
 * @param {string} breadcrumbType - "Games" or "Reels"
 * @param {string} breadcrumbItemName - Current game or project name
 * @param {string} editorMode - Current mode ('annotate' | 'framing' | 'overlay')
 * @param {function} onModeChange - Mode switch handler
 * @param {boolean} hasProject - Whether a project/reel is selected
 * @param {boolean} hasWorkingVideo - Whether working video exists
 * @param {boolean} hasOverlayVideo - Whether overlay video is loaded
 * @param {boolean} framingOutOfSync - Whether framing changed since export
 * @param {boolean} hasAnnotateVideo - Whether annotate video/game is available
 * @param {boolean} isLoadingWorkingVideo - Whether working video is loading
 * @param {boolean} isAdmin - Whether user is admin
 * @param {function} onAdminClick - Navigate to admin panel
 * @param {React.ReactNode} extraControls - Optional extra controls (e.g., mobile clips toggle)
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
  isAdmin = false,
  onAdminClick,
  extraControls,
}) {
  return (
    <div className="flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 mb-4 sm:mb-8">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <Button
          variant="ghost"
          icon={Home}
          iconOnly
          onClick={onHomeClick}
          title="Home"
        />
        <div className="min-w-0">
          <Breadcrumb
            type={breadcrumbType}
            itemName={breadcrumbItemName}
            onTypeClick={onHomeClick}
          />
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        {extraControls}
        <CreditBalance />
        <GalleryButton />
        <SignInButton />
        {isAdmin && (
          <button
            onClick={onAdminClick}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-gray-400 hover:text-white text-sm"
            title="Admin Panel"
          >
            <ShieldCheck size={15} />
            <span className="hidden sm:inline font-medium">Admin</span>
          </button>
        )}
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
