import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', gap: 16, padding: 24, textAlign: 'center' }}>
          <h2 style={{ margin: 0, color: '#0f172a' }}>Something went wrong</h2>
          <p style={{ margin: 0, color: '#64748b' }}>Reload the page to continue. Your projects are saved.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
