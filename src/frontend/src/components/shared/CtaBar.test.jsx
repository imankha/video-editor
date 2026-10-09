import { render, screen, fireEvent } from '@testing-library/react';
import { Play, Share2, Trash2, ArrowLeft } from 'lucide-react';
import CtaBar from './CtaBar';
import ActionCard from './ActionCard';
import { useToastStore } from './Toast';

const sec = { icon: Share2, title: 'Share', onClick: () => {} };

describe('CtaBar (T12010)', () => {
  it('renders the primary first and exactly one primary, whatever the prop order', () => {
    render(
      <CtaBar
        exit={{ icon: ArrowLeft, title: 'Back', onClick: () => {} }}
        destructive={{ icon: Trash2, title: 'Delete', onClick: () => {} }}
        secondary={[sec]}
        primary={{ icon: Play, title: 'Mark play', onClick: () => {} }}
      />,
    );
    const bar = screen.getByTestId('cta-bar');
    const roles = [...bar.querySelectorAll('[data-cta-role]')].map((el) => el.getAttribute('data-cta-role'));
    expect(roles).toEqual(['primary', 'secondary', 'destructive', 'exit']);
    expect(roles.filter((r) => r === 'primary')).toHaveLength(1);
  });

  it('locked items carry aria-disabled, a Lock icon, and show the lockedReason toast on tap', () => {
    const onClick = vi.fn();
    useToastStore.setState({ toasts: [] });
    render(<CtaBar primary={{ icon: Play, title: 'Generate', onClick, lockedReason: 'Frame a clip first' }} />);
    const btn = screen.getByText('Generate').closest('button');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('svg.lucide-lock')).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Frame a clip first');
  });

  it('every card in a row shares the same disc size', () => {
    render(<CtaBar primary={{ icon: Play, title: 'A', onClick() {} }} secondary={[sec, { ...sec, title: 'B' }]} />);
    const discs = screen.getByTestId('cta-bar').querySelectorAll('[data-cta-disc]');
    expect(discs.length).toBe(3);
    discs.forEach((d) => expect(d.className).toContain('h-11 w-11'));
  });

  it('ActionCard primary variant is solid cyan; testId is applied', () => {
    render(<ActionCard variant="primary" icon={Play} title="Go" data-testid="x" />);
    expect(screen.getByTestId('x').className).toContain('bg-cyan-500');
  });
});
