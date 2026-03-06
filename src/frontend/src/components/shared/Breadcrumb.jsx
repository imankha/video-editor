import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumb - Shows navigation context
 *
 * Displays the current location in the app hierarchy.
 * Format: Type › Item Name
 *
 * @param {string} type - Category type ('Games' or 'Projects')
 * @param {string} itemName - Name of the selected item (optional)
 */
export function Breadcrumb({ type, itemName }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 text-sm">{type}</span>
      {itemName && (
        <>
          <ChevronRight className="w-4 h-4 text-gray-600" />
          <span className="text-white font-semibold text-lg truncate">{itemName}</span>
        </>
      )}
    </div>
  );
}

export default Breadcrumb;
