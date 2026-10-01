import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const auth = vi.hoisted(() => ({ user: null, oauth: null }));

vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user, loading: false, signOut: vi.fn() }) }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { get oauth() { return auth.oauth; } } } }));
vi.mock('../src/components/AuthModal', () => ({ default: () => <div>auth modal</div> }));

const { default: OAuthConsentPage } = await import('../src/components/OAuthConsentPage.jsx');

describe('OAuth consent page', () => {
  const realLocation = window.location;
  beforeEach(() => {
    delete window.location;
    window.location = { search: '?authorization_id=auth-123', assign: vi.fn() };
    auth.oauth = {
      getAuthorizationDetails: vi.fn(async () => ({ data: { authorization_id: 'auth-123', client: { name: 'Claude' }, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scope: '' }, error: null })),
      approveAuthorization: vi.fn(async () => ({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=xyz' }, error: null })),
      denyAuthorization: vi.fn(async () => ({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' }, error: null })),
    };
  });
  afterEach(() => {
    cleanup();
    window.location = realLocation;
  });

  it('asks a signed-out visitor to sign in first', () => {
    auth.user = null;
    render(<OAuthConsentPage />);
    fireEvent.click(screen.getByText('Sign in or create an account'));
    expect(screen.getByText('auth modal')).toBeTruthy();
    expect(auth.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('names the app and returns to it with the code once allowed', async () => {
    auth.user = { id: 'u1', email: 'geo@example.com' };
    render(<OAuthConsentPage />);
    await waitFor(() => expect(screen.getByText('Claude')).toBeTruthy());
    fireEvent.click(screen.getByText('Allow'));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=xyz'));
    expect(auth.oauth.approveAuthorization).toHaveBeenCalledWith('auth-123');
  });

  it('skips the question when the app was already allowed', async () => {
    auth.user = { id: 'u1', email: 'geo@example.com' };
    auth.oauth.getAuthorizationDetails = vi.fn(async () => ({ data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=again' }, error: null }));
    render(<OAuthConsentPage />);
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=again'));
  });
});
