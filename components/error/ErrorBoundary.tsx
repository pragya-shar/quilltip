'use client'

import { Component, ReactNode } from 'react'
import { SectionFailure } from './SectionFailure'

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
          <SectionFailure
            title="Something went wrong."
            description="This section ran into a problem. Try loading it again."
            onRetry={this.reset}
          />
        )
      )
    }
    return this.props.children
  }
}
