import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumb - Shows navigation context
 *
 * Displays the current location in the app hierarchy.
 * Format: Type › Item Name
 *
 * @param {string} type - Category type ('Games' or 'Reel Drafts')
 * @param {string} itemName - Name of the selected item (optional)
 * @param {function} onTypeClick - Callback when type label is clicked (navigates home)
 */
export function Breadcrumb({ type, itemName, onTypeClick }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {onTypeClick ? (
        <button
          onClick={onTypeClick}
          className="text-gray-400 text-sm hover:text-white transition-colors cursor-pointer"
        >
          {type}
        </button>
      ) : (
        <span className="text-gray-400 text-sm">{type}</span>
      )}
      {itemName && (
        <>
          <ChevronRight className="w-4 h-4 text-gray-600" />
          <span className="text-white font-semibold text-sm sm:text-lg truncate">{itemName}</span>
        </>
      )}
    </div>
  );
}

export default Breadcrumb;
