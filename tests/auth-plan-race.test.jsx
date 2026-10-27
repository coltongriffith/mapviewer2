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
  from: () => ({ select: () => ({ eq: (_key, id) => ({ maybeSingle: () => new Promise((resolve, reject) => mock.requests.push({ id, resolve, reject })) }) }) }),
} }));
const account = id => ({ id, created_at: '2026-08-01T00:00Z', email: `${id}@example.test` });
const earlyAccount = id => ({ ...account(id), created_at: '2026-07-01T00:00Z' });
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => { mock.requests = []; localStorage.clear(); });
it('keeps grandfathered Pro access while the optional Company lookup is pending', async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => mock.sessionResolve({ data: { session: { user: earlyAccount('early') } } }));
  expect(mock.requests).toHaveLength(1);
  expect(result.current.tier).toBe('pro');
  expect(result.current.isPro).toBe(true);
  expect(result.current.planReady).toBe(true);
  expect(result.current.planSource).toBe('grandfathered');
});
it('honors an explicit Company assignment without downgrading a pending refresh', async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => mock.sessionResolve({ data: { session: { user: earlyAccount('company') } } }));
  await act(async () => mock.requests[0].resolve({ data: { plan: 'company', source: 'admin' } }));
  expect(result.current.tier).toBe('company');
  expect(result.current.entitlements.max_monitored_tenures).toBe(500);
  expect(result.current.isPro).toBe(true);
  expect(result.current.planDenied).toBe(false);
  act(() => { result.current.refreshPlan(); });
  expect(result.current.tier).toBe('company');
  await act(async () => mock.requests[1].resolve({ data: { plan: 'pro', source: 'grandfathered' } }));
  expect(result.current.tier).toBe('pro');
});
it.each(['missing', 'free', 'error', 'rejected'])('preserves the grandfathered backstop after a %s lookup', async outcome => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => mock.sessionResolve({ data: { session: { user: earlyAccount('early') } } }));
  await act(async () => {
    if (outcome === 'rejected') mock.requests[0].reject(new Error('offline'));
    else mock.requests[0].resolve(outcome === 'error' ? { data: null, error: { message: 'unavailable' } }
      : { data: outcome === 'missing' ? null : { plan: 'free', source: 'signup' } });
  });
  expect(result.current.tier).toBe('pro');
  expect(result.current.planSource).toBe('grandfathered');
});
it('never carries an early Company account into the next account', async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => mock.sessionResolve({ data: { session: { user: earlyAccount('old-company') } } }));
  await act(async () => mock.requests[0].resolve({ data: { plan: 'company', source: 'admin' } }));
  act(() => { result.current.refreshPlan(); });
  act(() => mock.authChange('SIGNED_IN', { user: earlyAccount('new-early') }));
  expect(result.current.tier).toBe('pro');
  await act(async () => mock.requests[1].resolve({ data: { plan: 'company', source: 'admin' } }));
  expect(result.current.user.id).toBe('new-early');
  expect(result.current.tier).toBe('pro');
  act(() => mock.authChange('SIGNED_IN', { user: account('new-free') }));
  expect(result.current.tier).toBe('free');
  await act(async () => mock.requests[2].resolve({ data: { plan: 'company', source: 'admin' } }));
  expect(result.current.tier).toBe('free');
});
it('grants Company to a post-launch account only after confirmation, with at most Pro grace on failure', async () => {
  const { result } = renderHook(useAuth, { wrapper });
  await act(async () => mock.sessionResolve({ data: { session: { user: account('company') } } }));
  expect(result.current.tier).toBe('free');
  await act(async () => mock.requests[0].resolve({ data: { plan: 'company', source: 'admin' } }));
  expect(result.current.tier).toBe('company');
  expect(result.current.isPro).toBe(true);
  act(() => { result.current.refreshPlan(); });
  await act(async () => mock.requests[1].reject(new Error('offline')));
  expect(result.current.tier).toBe('pro');
  expect(result.current.entitlements.max_monitored_tenures).toBe(50);
});
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
