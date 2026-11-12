import { Component, type ReactNode } from 'react';

/** Last-resort guard: a rendering crash shows a recoverable message instead of a blank screen. Saved data is unaffected. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-msg"><div>
        <h2 style={{ fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>Something went wrong displaying this page</h2>
        <p style={{ marginBottom: 12 }}>Your saved content is safe. {this.state.error.message}</p>
        <button className="btn primary" onClick={() => { this.setState({ error: null }); window.location.reload(); }}>Reload</button>
      </div></div>
    );
  }
}
