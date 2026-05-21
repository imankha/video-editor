import { render, screen, fireEvent } from '@testing-library/react';
import { InstallButton } from '../InstallButton';
import * as hookModule from '../../hooks/useInstallPrompt';

vi.mock('../../hooks/useInstallPrompt');

const defaultHook = {
  canInstall: false,
  canPrompt: false,
  platform: 'desktop',
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

  it('calls promptInstall directly when canPrompt is true', () => {
    const promptInstall = vi.fn();
    mockHook({ canInstall: true, canPrompt: true, promptInstall });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    expect(promptInstall).toHaveBeenCalled();
    expect(screen.queryByText('Install Reel Ballers')).toBeNull();
  });

  it('opens panel with Android instructions on Android without prompt', () => {
    mockHook({ canInstall: true, canPrompt: false, platform: 'android' });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    expect(screen.getByText('Install the App')).toBeTruthy();
    expect(screen.getByText(/Install app/)).toBeTruthy();
  });

  it('opens panel with iOS instructions on iOS', () => {
    mockHook({ canInstall: true, platform: 'ios' });
    render(<InstallButton />);
    fireEvent.click(screen.getByText('Install'));
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
    expect(screen.getByText(/Share icon/)).toBeTruthy();
  });
});
