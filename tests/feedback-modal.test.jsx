import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../src/lib/supabase', () => ({ supabase: null }));

import FeedbackModal from '../src/components/FeedbackModal';
import ErrorBoundary from '../src/components/ErrorBoundary';
import { reportError } from '../src/utils/errorReporter';

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, id: 'fb-1' }) }));
  globalThis.fetch = fetchMock;
});
afterEach(() => { vi.restoreAllMocks(); });

const feedbackCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/feedback');
const lastBody = () => JSON.parse(feedbackCalls().at(-1)[1].body);

describe('FeedbackModal', () => {
  it('submits kind, message and diagnostics, then confirms', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} userEmail="me@example.test" />);
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument();
    // Signed-in: no contact field, identity comes from the bearer token.
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Something broke' }));
    await user.type(screen.getByLabelText('What went wrong?'), 'PDF export never finishes');
    await user.click(screen.getByRole('button', { name: 'Report problem' }));

    await screen.findByRole('dialog', { name: 'Thanks — got it' });
    expect(feedbackCalls()).toHaveLength(1);
    const body = lastBody();
    expect(body).toMatchObject({ kind: 'bug', message: 'PDF export never finishes' });
    expect(body.context.viewport).toMatch(/^\d+x\d+$/);
    expect(body.sessionId).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks an empty message client-side and shows the server error verbatim', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/tell us what happened/i);
    expect(feedbackCalls()).toHaveLength(0);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({ error: 'Too many reports from this address.' }) });
    await user.type(screen.getByLabelText('Your message'), 'more please');
    await user.type(screen.getByLabelText(/Email/), 'me@example.test');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many reports from this address.'));
    expect(lastBody().email).toBe('me@example.test');
  });

  it('attaches the recent client errors from this tab', async () => {
    const user = userEvent.setup();
    reportError(new Error('tile fetch failed'), { kind: 'error' });
    render(<FeedbackModal onClose={() => {}} initialKind="bug" />);
    await user.type(screen.getByLabelText('What went wrong?'), 'map went blank');
    await user.click(screen.getByRole('button', { name: 'Report problem' }));
    await screen.findByRole('dialog', { name: 'Thanks — got it' });
    expect(lastBody().context.recentErrors.map(e => e.message)).toContain('tile fetch failed');
  });
});

describe('ErrorBoundary crash screen', () => {
  it('offers a report form that carries the crash message', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom() { throw new Error('render exploded'); }
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Report this problem' }));
    await user.type(screen.getByLabelText('What went wrong?'), 'I clicked export');
    await user.click(screen.getByRole('button', { name: 'Report problem' }));
    await screen.findByRole('dialog', { name: 'Thanks — got it' });
    const body = lastBody();
    expect(body.kind).toBe('bug');
    expect(body.context.crash).toBe('render exploded');
    spy.mockRestore();
  });
});
