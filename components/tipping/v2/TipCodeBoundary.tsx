'use client'

import {
  Component,
  createRef,
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
// The same constraint as React.lazy, so any component type passes through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function retryableLazy<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>
): {
  readonly Component: LazyExoticComponent<T>
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

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Props {
  /** Called before the boundary renders its children again. */
  onRetry: () => void
  /** A function, so a retry reads the new lazy component. */
  children: () => ReactNode
  /** `inline` stands in for a tip button on the page; `dialog` fills a dialog. */
  variant?: 'dialog' | 'inline'
}

/**
 * Keeps a failed load of tip code (the tip button, the tip form, the basket)
 * to the tip control. Without it the error reaches the article's boundary,
 * and the article text disappears (#669).
 */
export class TipCodeBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  private box = createRef<HTMLDivElement>()
  private moveFocus = false
  private frame = 0

  private retry = () => {
    // The pressed Try again unmounts: hand focus to what replaces it, so a
    // keyboard or screen reader user keeps their place in the article.
    this.moveFocus = !!this.box.current?.contains(document.activeElement)
    this.props.onRetry()
    this.setState({ failed: false })
  }

  override componentDidUpdate() {
    if (!this.moveFocus) return
    cancelAnimationFrame(this.frame)
    let frames = 0
    const tryFocus = () => {
      // Stop if the reader has moved on while the code loads: focus is no
      // longer on the body (where the unmounted Try again left it) or here.
      const active = document.activeElement
      const box = this.box.current
      if (active && active !== document.body && !box?.contains(active)) {
        this.moveFocus = false
        return
      }
      const target = box?.querySelector<HTMLElement>(FOCUSABLE)
      if (target) {
        this.moveFocus = false
        target.focus({ preventScroll: true })
      } else if (++frames < 300) {
        // The code may still be loading behind the Suspense fallback.
        this.frame = requestAnimationFrame(tryFocus)
      } else {
        this.moveFocus = false
      }
    }
    tryFocus()
  }

  override componentWillUnmount() {
    cancelAnimationFrame(this.frame)
  }

  override render() {
    return (
      <div ref={this.box} style={{ display: 'contents' }}>
        {this.content()}
      </div>
    )
  }

  private content() {
    if (!this.state.failed) return this.props.children()
    if (this.props.variant === 'inline')
      return (
        <p className="tip-v2-code-failed-inline" role="alert">
          {TIP_CODE_FAILED.inline}{' '}
          <button type="button" className="tip-v2-retry" onClick={this.retry}>
            {TIP_CODE_FAILED.retry}
          </button>
        </p>
      )
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
