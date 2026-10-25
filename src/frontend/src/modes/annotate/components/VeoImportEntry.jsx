import { useRef } from 'react';
import { FileArchive } from 'lucide-react';
import ActionCard from '../../../components/shared/ActionCard';
import { VEO_SUGGESTIONS as T } from '../../../config/displayNames';

/**
 * T13220: the "Import Veo highlights (.zip)" entry in Annotate's Add-footage area. Opens the
 * file picker; the chosen zip goes to `onFile` (the import sheet reads it locally, uploads nothing).
 */
export function VeoImportEntry({ onFile, disabled = false }) {
  const inputRef = useRef(null);
  return (
    <>
      <ActionCard
        icon={FileArchive}
        title={T.ENTRY_TITLE}
        description={T.ENTRY_DESCRIPTION}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        data-testid="veo-import-entry"
      />
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        data-testid="veo-import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

export default VeoImportEntry;
