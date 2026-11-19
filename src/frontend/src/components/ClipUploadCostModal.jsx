import { Upload } from 'lucide-react';
import { Button } from './shared/Button';
import { DialogShell } from './shared/DialogShell';
import { CreditCostRow } from './shared/CreditCostRow';
import { CLIP_UPLOAD } from '../config/displayNames';
import { useCreditStore } from '../stores/creditStore';
import { calculateStorageCost } from '../utils/storageCost';

/**
 * T17760: the price of a play upload, shown after the pick and before anything uploads
 * or is charged. The backend charges ONE debit on the batch's summed bytes
 * (clips.py upload_clips_batch -> calculate_storage_cost, no auto-export surcharge), so
 * the total here is calculateStorageCost over every file that will upload. Upload is the
 * gesture that starts the charged upload; Cancel drops the pick.
 */
export function ClipUploadCostModal({ files, onCancel, onConfirm }) {
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);
  if (!files || files.length === 0) return null;

  const cost = calculateStorageCost(files.reduce((sum, f) => sum + f.size, 0));

  return (
    <DialogShell
      labelledBy="clip-cost-title"
      onClose={onCancel}
      panelTestId="clip-upload-cost"
    >
      <h2 id="clip-cost-title" className="text-lg font-semibold text-white p-5 border-b border-gray-700 break-words">
        {CLIP_UPLOAD.costTitle(files.length, files[0].name)}
      </h2>
      <div className="p-5">
        <CreditCostRow cost={cost} balance={loaded ? balance : '…'} note={CLIP_UPLOAD.COST_NOTE} />
      </div>
      <div className="p-4 border-t border-gray-700 flex gap-3 justify-end">
        <Button variant="secondary" size="md" onClick={onCancel}>
          {CLIP_UPLOAD.COST_CANCEL}
        </Button>
        <Button variant="success" size="md" icon={Upload} onClick={onConfirm} data-testid="clip-upload-cost-confirm">
          {CLIP_UPLOAD.COST_CONFIRM}
        </Button>
      </div>
    </DialogShell>
  );
}

export default ClipUploadCostModal;
