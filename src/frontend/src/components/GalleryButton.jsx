import { Image } from 'lucide-react';
import { useGalleryStore } from '../stores/galleryStore';
import { Button } from './shared/Button';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';

/**
 * GalleryButton - Self-contained button that opens the Downloads/Gallery panel
 *
 * Uses galleryStore directly - no props needed from parent components.
 * Displays a badge with the download count when > 0.
 */
export function GalleryButton() {
  const open = useGalleryStore((state) => state.open);
  const unwatchedCount = useGalleryStore((state) => state.unwatchedCount);

  return (
    <Button
      variant="outline"
      size="md"
      icon={Image}
      onClick={open}
      title={SECTION_NAMES.LIBRARY}
      className={`${REEL.accent} ${REEL.borderSubtle} hover:bg-cyan-900/30 hover:text-cyan-300 hover:border-cyan-500`}
    >
      <span className="hidden sm:inline">{SECTION_NAMES.LIBRARY}</span>
      {unwatchedCount > 0 && (
        <span className="px-1.5 py-0.5 bg-cyan-500 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
          {unwatchedCount}
        </span>
      )}
    </Button>
  );
}

export default GalleryButton;
