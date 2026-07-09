import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export default class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ROUTE][ERROR_BOUNDARY]", error.message, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-full bg-(--color-surface) p-4">
            <span className="text-2xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-(--color-text)">
            Unable to render this page
          </h2>
          <p className="max-w-md text-sm text-(--color-muted)">
            An unexpected error occurred while rendering. Try navigating back or refreshing.
          </p>
          <p className="rounded-md bg-(--color-surface) px-3 py-1.5 text-xs font-mono text-(--color-muted)">
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.hash = "#/home";
            }}
            className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
          >
            Go Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
