'use client'

/**
 * Contains every payments failure. The engine renders inside this boundary,
 * beside the page, so a payments query that throws (a function missing
 * during a deploy, a server error, a schema mismatch, the network) never
 * reaches the app's own boundaries: the page, its navigation and sign-in
 * keep working, and the payments views read "unavailable". The shell
 * remounts the engine after a delay or on navigation.
 */
import { Component, type ReactNode } from 'react'

export class PaymentsBoundary extends Component<
  { children: ReactNode; onError(error: unknown): void },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    this.props.onError(error)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
