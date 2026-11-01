// T14230 real-browser harness (NOT part of CI). Renders the REAL GlobalExportIndicator with a
// seeded processing export over the REAL ExportButtonView (whose ActionBand publishes
// --cta-bar-h) inside an editor-like shell: App's flex-1 overflow-auto pane + the editors'
// `sticky bottom-0` band wrapper. ?screen=spotlight passes the Overlay band's "Add text" card,
// ?screen=frame the Focus band's Trim/Preview pair, so the band height matches each editor.
// No backend. Harness-only layout uses inline styles (tailwind scans src/ only). T14230-verify.mjs drives it and measures the boxes.
import { createRoot } from 'react-dom/client';
import { Type, Scissors, Eye } from 'lucide-react';
import '../../src/index.css';
import ExportButtonView from '../../src/components/ExportButtonView';
import ActionCard from '../../src/components/shared/ActionCard';
import { GlobalExportIndicator } from '../../src/components/GlobalExportIndicator';
import { useExportStore } from '../../src/stores/exportStore';

const screen = window.__T14230_SCREEN; // set by index.html before app modules can rewrite the URL
const isFraming = screen === 'frame';
const noop = () => {};

useExportStore.setState({
  activeExports: {
    export_1: {
      exportId: 'export_1',
      projectId: 7,
      projectName: 'Saturday vs Riptide',
      type: isFraming ? 'framing' : 'overlay',
      status: 'processing',
      progress: { current: 42, total: 100, percent: 42, message: 'Rendering...' },
      startedAt: new Date(Date.now() - 30000).toISOString(),
      completedAt: null,
      error: null,
    },
  },
});

const actionsAbove = isFraming ? (
  <>
    <ActionCard compact phoneRow icon={Scissors} title="Trim and SlowMo" description="Cut and slow plays." data-testid="h-trim" onClick={noop} />
    <ActionCard compact phoneRow icon={Eye} title="Preview highlight" description="Watch it first." data-testid="h-preview" onClick={noop} />
  </>
) : (
  <div className="col-span-2">
    <ActionCard compact phoneRow icon={Type} title="Add text" description="Add a name, number, or caption." data-testid="overlay-add-text-button" onClick={noop} />
  </div>
);

function Harness() {
  return (
    <div className="h-screen flex flex-col">
      <div className="flex-1 overflow-auto px-3 sm:px-4">
        <div className="flex flex-col min-h-full">
          {/* Inline style: tailwind only scans src/, so harness-only arbitrary classes never compile. */}
          <div className="flex-1 text-gray-500 p-4" style={{ minHeight: 1200 }}>editor content</div>
          <div className="sticky bottom-0 z-30 mt-4 sm:mt-6 -mx-3 sm:-mx-4 relative overflow-x-clip">
            <ExportButtonView
              isCurrentlyExporting
              isExporting
              displayProgress={42}
              isFramingMode={isFraming}
              hasUnframedClips={false}
              actionsAbove={actionsAbove}
              isButtonDisabled
              buttonTitle="Generating..."
              onExport={noop}
              onRetryConnection={noop}
              onDismissExport={noop}
              showInsufficientCredits={false}
              onCloseInsufficientCredits={noop}
            />
          </div>
        </div>
      </div>
      <GlobalExportIndicator />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
