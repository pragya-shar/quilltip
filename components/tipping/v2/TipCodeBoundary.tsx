'use client'

import {
  Component,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import { TIP_CODE_FAILED } from '@/lib/copy/tip-flow'

/**
 * A lazily loaded tip component whose failed load can be tried again.
 * `React.lazy` keeps a rejected import for good, so `retry` makes a new one.
 */
export function retryableLazy<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>
): {
  readonly Component: LazyExoticComponent<ComponentType<P>>
  retry: () => void
} {
  let current = lazy(load)
  return {
    get Component() {
      return current
    },
    retry() {
      current = lazy(load)
    },
  }
}

interface Props {
  /** Called before the boundary renders its children again. */
  onRetry: () => void
  /** A function, so a retry reads the new lazy component. */
  children: () => ReactNode
}

/**
 * Keeps a failed load of the tip form inside the tip dialog. Without it the
 * error reaches the article's boundary, and the article text disappears.
 */
export class TipCodeBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  private retry = () => {
    this.props.onRetry()
    this.setState({ failed: false })
  }

  override render() {
    if (!this.state.failed) return this.props.children()
    return (
      <div className="tip-v2-code-failed" role="alert">
        <p>
          <strong>{TIP_CODE_FAILED.title}</strong>
        </p>
        <p>{TIP_CODE_FAILED.detail}</p>
        <button type="button" className="tip-v2-retry" onClick={this.retry}>
          {TIP_CODE_FAILED.retry}
        </button>
      </div>
    )
  }
}
