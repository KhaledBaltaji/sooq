"use client";
import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { ErrorState } from "./error-state";

interface Props {
  children: ReactNode;
  /**
   * What to render when an error is caught. Pass `null` to render nothing
   * (useful for non-essential globally-mounted side panels). When omitted,
   * falls back to the default `<ErrorState/>` UI with a retry button.
   */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <ErrorState onRetry={() => this.setState({ hasError: false })} />
      );
    }
    return this.props.children;
  }
}
