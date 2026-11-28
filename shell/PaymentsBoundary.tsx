'use client'

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; onError?: (error: unknown) => void }
type State = { failed: boolean }

/**
 * Catches anything the payments layer throws. It renders nothing in its
 * place: the page and its text stay, and money views read "unavailable"
 * from the payments store.
 */
export class PaymentsBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('Payments failed; the page stays up.', error)
    this.props.onError?.(error)
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
