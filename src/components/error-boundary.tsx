"use client";

import { Component, type ReactNode } from "react";
import { errorMessage } from "@/lib/format";

/** Catches errors thrown by Convex queries so one bad view can't blank the app. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-danger/30 bg-danger-soft p-6 text-sm text-danger">
          <p className="font-medium">This page couldn&apos;t load.</p>
          <p className="mt-1">{errorMessage(this.state.error)}</p>
          <button
            className="mt-3 underline underline-offset-4 cursor-pointer"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
