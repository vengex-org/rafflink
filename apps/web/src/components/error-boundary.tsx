import { errorClass } from "@rafflink/core/lib/error-class"
import { Component, type ReactNode } from "react"
import { reportError } from "../lib/error-reporting.ts"

interface ErrorBoundaryProps {
  /** Shown instead of the children once one of them threw while rendering. */
  readonly fallback: ReactNode
  readonly children: ReactNode
}

/** Catches a render error below it, reports it and shows the fallback until the page is loaded again. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error("render failed", { errorClass: errorClass(error) })
    reportError(error)
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
