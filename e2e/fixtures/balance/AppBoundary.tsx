/**
 * Stands in for the app's own boundary around the page (the one that shows
 * "Wallet connection unavailable."). If a payments error ever reached it,
 * the whole page would go, which the containment tests rule out.
 */
import { Component, type ReactNode } from 'react'

export class AppBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? (
      <h1 data-testid="app-fallback">Wallet connection unavailable.</h1>
    ) : (
      this.props.children
    )
  }
}
