'use client'

import { Component, ReactNode } from 'react'

export type ErrorBoundaryFallbackRender = (ctx: {
  reset: () => void
  error: Error | null
}) => ReactNode

interface Props {
  children: ReactNode
  fallback?: ReactNode | ErrorBoundaryFallbackRender
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  private reset = () => {
    this.setState({ hasError: false, error: null })
  }

  override render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      if (typeof fallback === 'function') {
        return fallback({
          reset: this.reset,
          error: this.state.error,
        })
      }
      return (
        fallback || (
          <div className="p-4 border border-destructive/30 bg-destructive/10 rounded-lg">
            <p className="text-destructive">Something went wrong.</p>
            <button
              onClick={this.reset}
              className="mt-2 text-sm text-destructive underline"
            >
              Try again
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
