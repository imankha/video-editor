import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumb - Shows navigation context
 *
 * Displays the current location in the app hierarchy.
 * Format: Type › Game Name › Item Name
 *
 * @param {string} type - Category type ('Games' or 'Clips')
 * @param {string} gameName - Name of the clip's source game (optional, e.g. "Vs Carlsbad Game Sep 1")
 * @param {string} itemName - Name of the selected item (optional)
 * @param {function} onTypeClick - Callback when type label is clicked (navigates home)
 * @param {function} onGameClick - Callback when the game name is clicked (navigates to Annotate for that game)
 */
export function Breadcrumb({ type, gameName, itemName, onTypeClick, onGameClick }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {onTypeClick ? (
        <button
          onClick={onTypeClick}
          className="text-gray-400 text-sm hover:text-white transition-colors cursor-pointer flex-shrink-0"
        >
          {type}
        </button>
      ) : (
        <span className="text-gray-400 text-sm flex-shrink-0">{type}</span>
      )}
      {gameName && (
        <>
          <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
          {onGameClick ? (
            <button
              onClick={onGameClick}
              title={gameName}
              className="text-gray-400 text-sm hover:text-white transition-colors cursor-pointer truncate min-w-0"
            >
              {gameName}
            </button>
          ) : (
            <span title={gameName} className="text-gray-400 text-sm truncate min-w-0">{gameName}</span>
          )}
        </>
      )}
      {itemName && (
        <>
          <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
          <span className="text-white font-semibold text-sm sm:text-lg truncate">{itemName}</span>
        </>
      )}
    </div>
  );
}

export default Breadcrumb;
