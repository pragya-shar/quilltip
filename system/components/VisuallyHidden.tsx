import type { ReactNode } from 'react'

/** Text for assistive technology only. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="qt-visually-hidden">{children}</span>
}
