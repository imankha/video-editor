import { render, screen, fireEvent } from '@testing-library/react';
import { InstallButton } from '../InstallButton';
import * as hookModule from '../../hooks/useInstallPrompt';

vi.mock('../../hooks/useInstallPrompt');

const defaultHook = {
  canInstall: false,
  canPrompt: false,
  isIOS: false,
  isInstalled: false,
  promptInstall: vi.fn(),
  dismiss: vi.fn(),
};

function mockHook(overrides = {}) {
  vi.mocked(hookModule.useInstallPrompt).mockReturnValue({ ...defaultHook, ...overrides });
}

describe('InstallButton', () => {
  it('renders nothing when already installed', () => {
    mockHook({ isInstalled: true });
    const { container } = render(<InstallButton />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when canInstall is false', () => {
    mockHook({ canInstall: false });
    const { container } = render(<InstallButton />);
    expect(container.firstChild).toBeNull();
  });

  it('shows install button when canInstall is true', () => {
    mockHook({ canInstall: true });
    render(<InstallButton />);
    expect(screen.getByText('Install')).toBeTruthy();
  });

  it('opens benefit panel on click', () => {
    mockHook({ canInstall: true });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    expect(screen.getByText('Install Reel Ballers')).toBeTruthy();
    expect(screen.getByText(/Home screen icon/)).toBeTruthy();
  });

  it('calls promptInstall on Install button in panel', () => {
    const promptInstall = vi.fn();
    mockHook({ canInstall: true, canPrompt: true, promptInstall });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    const installButtons = screen.getAllByText('Install');
    fireEvent.click(installButtons[installButtons.length - 1]);
    expect(promptInstall).toHaveBeenCalled();
  });

  it('shows Android manual instructions when no deferred prompt', () => {
    mockHook({ canInstall: true, canPrompt: false });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
    expect(screen.getByText(/Install App/)).toBeTruthy();
  });

  it('shows iOS instructions when isIOS', () => {
    mockHook({ canInstall: true, isIOS: true });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
    expect(screen.getByText(/Share icon/)).toBeTruthy();
  });
});
