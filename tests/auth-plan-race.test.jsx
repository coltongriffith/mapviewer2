import React from 'react';
import { beforeEach, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';
const mock = vi.hoisted(() => ({ authChange: null, sessionResolve: null, requests: [] }));
vi.mock('../src/utils/attribution', () => ({ getAttribution: () => ({}), recordSignupOnce: () => {} }));
vi.mock('../src/utils/track', () => ({ trackEvent: () => {} }));
vi.mock('../src/lib/supabase', () => ({ supabase: {
  auth: {
    getSession: () => new Promise(resolve => { mock.sessionResolve = resolve; }),
    onAuthStateChange: cb => { mock.authChange = cb; return { data: { subscription: { unsubscribe() {} } } }; },
  },
  from: () => ({ select: () => ({ eq: (_key, id) => ({ maybeSingle: () => new Promise(resolve => mock.requests.push({ id, resolve })) }) }) }),
} }));
const account = id => ({ id, created_at: '2026-08-01T00:00Z', email: `${id}@example.test` });
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => { mock.requests = []; localStorage.clear(); });
it('ignores a former account’s slow Pro response after switching accounts', async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => mock.sessionResolve({ data: { session: null } }));
  act(() => mock.authChange('SIGNED_IN', { user: account('old-pro') }));
  act(() => mock.authChange('SIGNED_IN', { user: account('new-free') }));
  await act(async () => mock.requests.find(r => r.id === 'new-free').resolve({ data: { plan: 'free', source: 'signup' } }));
  await act(async () => mock.requests.find(r => r.id === 'old-pro').resolve({ data: { plan: 'pro', source: 'stripe' } }));
  expect(result.current.user.id).toBe('new-free');
  expect(result.current.isPro).toBe(false);
});
it('does not restore an old session after sign-out wins the initial session race', async () => {
  const { result } = renderHook(useAuth, { wrapper });
  act(() => mock.authChange('SIGNED_OUT', null));
  await act(async () => mock.sessionResolve({ data: { session: { user: account('old-pro') } } }));
  expect(result.current.user).toBeNull();
});
