import React from 'react';
import { reportError } from '../utils/errorReporter';
import FeedbackModal from './FeedbackModal';

export default class ErrorBoundary extends React.Component {
  state = { error: null, showFeedback: false };

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
      const crash = String(this.state.error?.message || this.state.error || '').slice(0, 300);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: "'Source Sans 3', system-ui, -apple-system, Segoe UI, sans-serif", gap: 16, padding: 24, textAlign: 'center' }}>
          <h2 style={{ margin: 0, color: '#142126' }}>Something went wrong</h2>
          <p style={{ margin: 0, color: '#5f6e72' }}>Reload the page to continue. Your projects are saved.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '10px 24px', background: '#142126', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
            >
              Reload
            </button>
            {/* The crash is already in the error sink; this captures what the
                user was doing when it happened, which the stack cannot say. */}
            <button
              onClick={() => this.setState({ showFeedback: true })}
              style={{ padding: '10px 24px', background: '#fff', color: '#142126', border: '1px solid #c6cecf', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
            >
              Report this problem
            </button>
          </div>
          {this.state.showFeedback && (
            <FeedbackModal
              initialKind="bug"
              context={{ crash }}
              onClose={() => this.setState({ showFeedback: false })}
            />
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
