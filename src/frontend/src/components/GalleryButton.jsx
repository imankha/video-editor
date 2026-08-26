import { Image } from 'lucide-react';
import { useGalleryStore } from '../stores/galleryStore';
import { Button } from './shared/Button';
import { SECTION_NAMES } from '../config/displayNames';

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
      variant="reelOutline"
      size="md"
      icon={Image}
      onClick={open}
      title={SECTION_NAMES.LIBRARY}
      // T7730: static accessible name. The label text is hidden below `sm` and
      // the live unread-count badge folds into the computed name, so the button's
      // accessible name was unstable (`getByRole('button', {name:'My Reels'})`
      // and real screen readers couldn't reliably find it). Pin it here and mark
      // the badge aria-hidden so the count never mangles the name.
      aria-label={SECTION_NAMES.LIBRARY}
    >
      <span className="hidden sm:inline">{SECTION_NAMES.LIBRARY}</span>
      {unwatchedCount > 0 && (
        <span
          aria-hidden="true"
          className="px-1.5 py-0.5 bg-cyan-500 text-white text-xs font-bold rounded-full min-w-[20px] text-center"
        >
          {unwatchedCount}
        </span>
      )}
    </Button>
  );
}

export default GalleryButton;
