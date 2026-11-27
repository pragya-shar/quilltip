'use client'

import { Component, type ReactNode } from 'react'
import { Button } from '@/system/components/Button'
import { Notice } from '@/system/components/Notice'

type Props = { children: ReactNode; onRetry: () => void }
type State = { failed: boolean }

/**
 * A sheet whose code did not load (or whose body threw) says so inside the
 * sheet, with Try again. The sheet is never left blank.
 */
export class SheetLoadBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('A sheet did not load.', error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <Notice
        tone="failure"
        live
        title="This did not load"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              this.setState({ failed: false })
              this.props.onRetry()
            }}
          >
            Try again
          </Button>
        }
      >
        Check your connection. Nothing was sent.
      </Notice>
    )
  }
}
