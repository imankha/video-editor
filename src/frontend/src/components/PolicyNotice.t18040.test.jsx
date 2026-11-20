import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// T18040: an existing user sees a one-time notice that the privacy policy changed, with a
// switch that turns off the use of their videos for internal testing. "Got it" records the
// acknowledgement; the notice cannot be closed any other way. The same switch lives under
// "Your privacy rights" in Account settings. Each change is one write.

vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { PolicyNotice } from './PolicyNotice';
import { AccountSettings } from './AccountSettings';
import { useAuthStore } from '../stores/authStore';
import { useCreditStore } from '../stores/creditStore';
import { POLICY_NOTICE_COPY } from '../config/displayNames';

const VERSION = '2026-11-20';

function ok(body = {}) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function fail() {
  return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
}
function callsTo(path) {
  return apiFetch.mock.calls.filter(([url]) => url === path);
}

beforeEach(() => {
  apiFetch.mockReset();
  useAuthStore.setState({
    isAuthenticated: true,
    showAccountSettings: false,
    impersonator: null,
    email: 'parent@example.com',
    policyNoticeVersion: null,
    useForTesting: null,
  });
  useCreditStore.setState({ loaded: false, balance: 0 });
});

describe('T18040 policy state from /me', () => {
  it('T18040:C1 an account that has not acknowledged the current version gets the notice', () => {
    useAuthStore.getState().setPolicyStateFromMe({
      needs_policy_notice: true, policy_version: VERSION, use_for_testing: true,
    });
    expect(useAuthStore.getState().policyNoticeVersion).toBe(VERSION);
    expect(useAuthStore.getState().useForTesting).toBe(true);
  });

  it('T18040:C2 an account that has acknowledged it (a new account) gets no notice', () => {
    useAuthStore.getState().setPolicyStateFromMe({
      needs_policy_notice: false, policy_version: VERSION, use_for_testing: false,
    });
    expect(useAuthStore.getState().policyNoticeVersion).toBeNull();
    expect(useAuthStore.getState().useForTesting).toBe(false);
  });
});

describe('T18040 policy notice', () => {
  it('T18040:C1 shows what changed, a link to the policy, the switch and Got it', () => {
    useAuthStore.setState({ policyNoticeVersion: VERSION, useForTesting: true });
    render(<PolicyNotice />);
    expect(screen.getByText(POLICY_NOTICE_COPY.TITLE)).toBeTruthy();
    expect(screen.getByText(POLICY_NOTICE_COPY.WHAT_CHANGED_AI)).toBeTruthy();
    expect(screen.getByText(POLICY_NOTICE_COPY.WHAT_CHANGED_TESTING)).toBeTruthy();
    expect(screen.getByRole('link', { name: POLICY_NOTICE_COPY.READ_POLICY }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('switch', { name: POLICY_NOTICE_COPY.TESTING_LABEL }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: POLICY_NOTICE_COPY.GOT_IT })).toBeTruthy();
  });

  it('T18040:C1 renders nothing when there is no notice', () => {
    render(<PolicyNotice />);
    expect(screen.queryByText(POLICY_NOTICE_COPY.TITLE)).toBeNull();
  });

  it('T18040:C1 does not close on a backdrop click or Escape', () => {
    useAuthStore.setState({ policyNoticeVersion: VERSION, useForTesting: true });
    render(<PolicyNotice />);
    fireEvent.click(screen.getByTestId('policy-notice-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText(POLICY_NOTICE_COPY.TITLE)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('T18040:C1 Got it records the version shown, once, and the notice goes away', async () => {
    apiFetch.mockImplementation(() => ok({ policy_version_acknowledged: VERSION }));
    useAuthStore.setState({ policyNoticeVersion: VERSION, useForTesting: true });
    render(<PolicyNotice />);
    fireEvent.click(screen.getByRole('button', { name: POLICY_NOTICE_COPY.GOT_IT }));
    await waitFor(() => expect(screen.queryByText(POLICY_NOTICE_COPY.TITLE)).toBeNull());
    const calls = callsTo('/api/auth/acknowledge-policy');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].method).toBe('POST');
    expect(JSON.parse(calls[0][1].body)).toEqual({ version: VERSION });
  });

  it('T18040:C1 a failed Got it keeps the notice open and says so', async () => {
    apiFetch.mockImplementation(() => fail());
    useAuthStore.setState({ policyNoticeVersion: VERSION, useForTesting: true });
    render(<PolicyNotice />);
    fireEvent.click(screen.getByRole('button', { name: POLICY_NOTICE_COPY.GOT_IT }));
    await screen.findByText(POLICY_NOTICE_COPY.ACKNOWLEDGE_ERROR);
    expect(screen.getByText(POLICY_NOTICE_COPY.TITLE)).toBeTruthy();
  });

  it('T18040:C3 the switch in the notice opts out with one write, without acknowledging', async () => {
    apiFetch.mockImplementation(() => ok({ use_for_testing: false }));
    useAuthStore.setState({ policyNoticeVersion: VERSION, useForTesting: true });
    render(<PolicyNotice />);
    fireEvent.click(screen.getByRole('switch', { name: POLICY_NOTICE_COPY.TESTING_LABEL }));
    await waitFor(() => expect(useAuthStore.getState().useForTesting).toBe(false));
    expect(callsTo('/api/auth/testing-consent')).toHaveLength(1);
    expect(callsTo('/api/auth/acknowledge-policy')).toHaveLength(0);
    expect(screen.getByText(POLICY_NOTICE_COPY.TITLE)).toBeTruthy();
  });
});

describe('T18040 Account settings switch', () => {
  it('T18040:C3 turns the testing use off then on, one write each', async () => {
    apiFetch.mockImplementation(() => ok());
    useAuthStore.setState({ showAccountSettings: true, useForTesting: true });
    render(<AccountSettings />);
    const toggle = screen.getByRole('switch', { name: POLICY_NOTICE_COPY.TESTING_LABEL });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(POLICY_NOTICE_COPY.TESTING_HINT)).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));

    const calls = callsTo('/api/auth/testing-consent');
    expect(calls).toHaveLength(2);
    expect(calls.map(([, opts]) => [opts.method, JSON.parse(opts.body)])).toEqual([
      ['PUT', { use_for_testing: false }],
      ['PUT', { use_for_testing: true }],
    ]);
  });

  it('T18040:C3 a failed change keeps the old value and says so', async () => {
    apiFetch.mockImplementation(() => fail());
    useAuthStore.setState({ showAccountSettings: true, useForTesting: true });
    render(<AccountSettings />);
    const toggle = screen.getByRole('switch', { name: POLICY_NOTICE_COPY.TESTING_LABEL });
    fireEvent.click(toggle);
    await screen.findByText(POLICY_NOTICE_COPY.TESTING_ERROR);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(useAuthStore.getState().useForTesting).toBe(true);
  });
});
