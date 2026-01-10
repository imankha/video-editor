import { Image } from 'lucide-react';
import { useGalleryStore } from '../stores/galleryStore';

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
    <button
      onClick={open}
      className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 rounded-lg transition-colors"
      title="Gallery"
    >
      <Image size={18} className="text-purple-400" />
      <span className="text-sm text-gray-400">Gallery</span>
      {count > 0 && (
        <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

export default GalleryButton;
