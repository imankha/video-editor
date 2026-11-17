import { useId } from 'react';
import { DialogShell } from './shared/DialogShell';
import { Button } from './shared/Button';
import { CreditCostRow } from './shared/CreditCostRow';
import { FINISHED_REDO } from '../config/displayNames';

/**
 * EditZoomSheet (T16530) - the confirmation Edit zoom shows on the Finished screen
 * before the parent goes back to Frame: what sharpening again costs and their
 * balance, or, once the game video has expired, that Edit zoom is unavailable.
 *
 * @param {{reframe_credits:number, game_video_available:boolean}} info - from redo-info
 * @param {number} balance     - current credit balance
 * @param {Function} onConfirm - go to Frame
 * @param {Function} onClose   - cancel
 */
export function EditZoomSheet({ info, balance, onConfirm, onClose }) {
  const titleId = useId();
  const available = info.game_video_available;
  return (
    <DialogShell isOpen onClose={onClose} variant="sheet" labelledBy={titleId} panelTestId="edit-zoom-sheet">
      <h3 id={titleId} className="text-lg font-semibold text-white">
        {available ? FINISHED_REDO.CONFIRM_TITLE : FINISHED_REDO.UNAVAILABLE_TITLE}
      </h3>
      <p className="mt-2 text-sm text-gray-300">
        {available ? FINISHED_REDO.CONFIRM_BODY : FINISHED_REDO.UNAVAILABLE_BODY}
      </p>
      {available && (
        <div className="mt-3">
          <CreditCostRow cost={info.reframe_credits} balance={balance} note={FINISHED_REDO.CONFIRM_NOTE} />
        </div>
      )}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
          {available ? FINISHED_REDO.CONFIRM_CANCEL : FINISHED_REDO.UNAVAILABLE_CLOSE}
        </Button>
        {available && (
          <Button variant="cyan" onClick={onConfirm} className="w-full sm:w-auto" data-testid="edit-zoom-confirm">
            {FINISHED_REDO.CONFIRM_CONTINUE}
          </Button>
        )}
      </div>
    </DialogShell>
  );
}

export default EditZoomSheet;
