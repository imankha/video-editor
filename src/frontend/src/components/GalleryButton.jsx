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
  const count = useGalleryStore((state) => state.count);

  return (
    <Button
      variant="ghost"
      size="md"
      icon={Image}
      onClick={open}
      title="Gallery"
    >
      Gallery
      {count > 0 && (
        <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Button>
  );
}

export default GalleryButton;
