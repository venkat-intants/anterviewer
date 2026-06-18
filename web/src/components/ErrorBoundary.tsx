// ErrorBoundary — React class error boundary wrapping the routed app.
// Renders a friendly fallback with a reload action and fires a toast.
// Catches unhandled render errors that React's concurrent mode surfaces.
// NOTE: Class component is required — React does not support hook-based
// error boundaries. We keep it as small as possible.

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : 'An unexpected error occurred.';
    return { hasError: true, errorMessage: msg };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const msg = error instanceof Error ? error.message : 'Unknown render error';
    // Non-blocking toast so the fallback UI renders first
    setTimeout(() => {
      toast.error(`App error: ${msg}`);
    }, 0);
    // In production you would send to Sentry here:
    // Sentry.captureException(error, { extra: info });
    // In dev, errors are already shown in the overlay; no extra logging needed.
  }

  handleReload = () => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main
          className="min-h-screen flex items-center justify-center bg-background px-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. Reload the page to try again.
              </p>
              {import.meta.env.DEV && this.state.errorMessage && (
                <p className="mt-2 rounded-md bg-muted px-4 py-2 text-left font-mono text-xs text-muted-foreground break-all">
                  {this.state.errorMessage}
                </p>
              )}
            </div>
            <Button onClick={this.handleReload} className="gap-2">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reload page
            </Button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
