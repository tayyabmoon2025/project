import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SchoolLogo } from '@/components/SchoolLogo';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';

type Props = { children: ReactNode };
type State = { error: Error | null };

// A blank screen tells the school nothing. If any part of the app fails to render,
// this catches it and shows a plain, actionable message instead of an empty page.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SchoolDesk failed to render:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-brand-mark"><SchoolLogo alt="SchoolDesk logo" /></div>
            <h1>{SCHOOL_NAME}</h1>
            <p>The page could not be displayed</p>
          </div>
          <div className="auth-form">
            <div className="auth-error">
              <AlertTriangle size={16} />
              <span>Something interrupted the page while it was loading. Reloading usually fixes this. If it keeps happening, please ask the school office to check this account.</span>
            </div>
            <button type="button" className="auth-submit" onClick={() => window.location.reload()}>
              <RefreshCw size={16} /> Reload the page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
