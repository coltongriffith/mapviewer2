import React from 'react';
import { reportError } from '../utils/errorReporter';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info);
    // A render crash is the most severe client failure there is — make sure
    // it reaches our error sink, not just the user's console.
    reportError(error, { kind: 'react', context: { componentStack: String(info?.componentStack || '').slice(0, 2000) } });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: "'Source Sans 3', system-ui, -apple-system, Segoe UI, sans-serif", gap: 16, padding: 24, textAlign: 'center' }}>
          <h2 style={{ margin: 0, color: '#142126' }}>Something went wrong</h2>
          <p style={{ margin: 0, color: '#5f6e72' }}>Reload the page to continue. Your projects are saved.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', background: '#142126', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
