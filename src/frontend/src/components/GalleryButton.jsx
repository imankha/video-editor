import { Image } from 'lucide-react';
import { useGalleryStore } from '../stores/galleryStore';
import { Button } from './shared/Button';

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
      variant="ghost"
      size="md"
      icon={Image}
      onClick={open}
      title="Gallery"
    >
      <span className="hidden sm:inline">Gallery</span>
      {unwatchedCount > 0 && (
        <span className="px-1.5 py-0.5 bg-cyan-500 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
          {unwatchedCount}
        </span>
      )}
    </Button>
  );
}

export default GalleryButton;
