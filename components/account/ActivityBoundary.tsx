'use client'
import { Component, type ReactNode } from 'react'
class HistoryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    if (this.state.failed)
      return (
        <div className="account-notice" role="alert">
          <p>
            Tip history couldn’t load. Your wallet settings are still available.
          </p>
          <button
            className="account-text-link"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
        </div>
      )
    return this.props.children
  }
}
export function ActivityBoundary({
  children,
  resetKey,
}: {
  children: ReactNode
  resetKey: string
}) {
  return <HistoryBoundary key={resetKey}>{children}</HistoryBoundary>
}
