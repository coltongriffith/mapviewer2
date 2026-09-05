import React, { useEffect, useState } from 'react';
import LandingPage from './components/LandingPage';
import { useAuth } from './hooks/useAuth.jsx';

const EditorApp = React.lazy(() => import('./App'));
const HowToUseModal = React.lazy(() => import('./components/HowToUseModal'));

export function needsWorkspace(location = window.location) {
  const params = new URLSearchParams(location.search);
  return location.pathname !== '/' || ['intent', 'demo', 'claims', 'tenure', 'billing', 'code'].some((key) => params.has(key))
    || /access_token=|type=recovery/.test(location.hash || '');
}

// Keep the workspace mounted once opened, so a trip home cannot lose edits.
export default function AppRouter() {
  const { user, loading } = useAuth();
  const [workspace, setWorkspace] = useState(() => needsWorkspace());
  const [help, setHelp] = useState(false);
  const [initialAction, setInitialAction] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  useEffect(() => {
    let cancelled = false;
    // Fresh visitors never load compression/export dependencies. Returning
    // local users retain their existing recent-map shortcuts.
    try {
      if (localStorage.getItem('mapviewer.projects.v1')) {
        import('./utils/projectStorage').then(({ listProjects }) => {
          if (!cancelled) setRecentProjects(listProjects());
        });
      }
    } catch { /* storage is optional */ }
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (!loading && user) setWorkspace(true); }, [loading, user]);
  useEffect(() => {
    const pop = () => { if (needsWorkspace()) setWorkspace(true); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const open = (params = {}, path = '/') => {
    const query = new URLSearchParams(params).toString();
    window.history.pushState({}, '', path + (query ? `?${query}` : ''));
    setWorkspace(true);
  };
  if (workspace) return <React.Suspense fallback={<div className="shared-map-loading" role="status">Opening your workspace…</div>}><EditorApp initialAction={initialAction} /></React.Suspense>;
  return <>
    <LandingPage
      recentProjects={recentProjects}
      onOpenProject={(entry) => { setInitialAction({ type: 'project', entry }); open({ intent: 'resume' }); }}
      onOpenEditor={() => open({ intent: 'claims' })}
      onLoadSample={() => open({ demo: 'aurora_demo' })}
      onLoadSampleStyle={(demo) => open({ demo })}
      onSearchBCClaims={(query) => open({ intent: 'claims', ...(typeof query === 'string' && query.trim() ? { query: query.trim() } : {}) })}
      onUploadFile={() => open({ intent: 'claims-upload' })}
      onOpenAccount={() => open({}, '/dashboard')}
      onOpenTenureMonitor={() => open({}, '/tenure-monitor')}
      onShowHelp={() => setHelp(true)}
    />
    {help && <React.Suspense fallback={null}><HowToUseModal onClose={() => setHelp(false)} /></React.Suspense>}
  </>;
}
