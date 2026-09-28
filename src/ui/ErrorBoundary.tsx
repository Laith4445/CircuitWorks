import { Component, type ReactNode } from 'react';

/** Keeps a drawing/plotting bug from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; what: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { children: ReactNode }) {
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return <div className="boundary">Sorry — {this.props.what} hit a bug and couldn't be drawn ({this.state.error.message}). Your circuit is safe; try running again.</div>;
    }
    return this.props.children;
  }
}
