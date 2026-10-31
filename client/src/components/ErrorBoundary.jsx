import { Component } from 'react';

/** Last line of defence: a render error shows a way out instead of a blank screen. */
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[ui] render error', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-bold">Something broke on our side</h1>
        <p className="mt-3 text-ink/70">Your votes and receipts are safe. Reload the page to continue.</p>
        <div className="mt-6 grid w-full grid-cols-2 gap-3">
          <button className="btn-pop" onClick={() => window.location.reload()}>Reload</button>
          <a className="btn-ghost" href="/">Go home</a>
        </div>
      </div>
    );
  }
}
