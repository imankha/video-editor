import { createRoot } from 'react-dom/client';
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog';
import { PlaysOnlyConfirmSheet } from '../components/PlaysOnlyConfirmSheet';
import { ClipUploadNoticeModal } from '../components/ClipUploadNoticeModal';
import { ClipUploadTooLargeModal } from '../components/ClipUploadTooLargeModal';
import { ClipSizeLimitModal } from '../components/ClipSizeLimitModal';
import { CreditHistoryModal } from '../components/CreditHistoryModal';
import '../index.css';
const n = () => {};
const D = {
  confirm: <ConfirmationDialog isOpen title="Delete this clip?" message="This cannot be undone." onClose={n}
    buttons={[{ label: 'Cancel', onClick: n }, { label: 'Delete', variant: 'danger', onClick: n }]} />,
  playsonly: <PlaysOnlyConfirmSheet title="Keep only marked plays?" body="The full game video is removed; your marked plays stay." confirmLabel="Keep plays" onCancel={n} onConfirm={n} />,
  notice: <ClipUploadNoticeModal isOpen onCancel={n} onContinue={n} />,
  toolarge: <ClipUploadTooLargeModal isOpen names={['big-game.mp4']} maxBytes={500 * 1024 * 1024} onDismiss={n} />,
  sizelimit: <ClipSizeLimitModal isOpen files={[{ name: 'big-game.mp4' }]} maxBytes={500 * 1024 * 1024} onAddGame={n} onCancel={n} />,
  credithistory: <CreditHistoryModal onClose={n} />,
};
createRoot(document.getElementById('dlg')).render(D[window.__d]);
