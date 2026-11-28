import type { ReactNode } from 'react'

/**
 * The label of an auth form's submit button. While a submit made before the
 * page scripts ran is held (lib/auth/earlySubmit.ts), CSS shows the busy
 * label in place of the ready one, so the press is answered from the next
 * frame. Once the form is busy, only the busy label is rendered.
 */
export function AccountSubmitLabel({
  busy,
  busyLabel,
  children,
}: {
  busy: boolean
  busyLabel: string
  children: ReactNode
}) {
  if (busy) return busyLabel
  return (
    <>
      <span className="account-ready-label">{children}</span>
      <span className="account-held-label">{busyLabel}</span>
    </>
  )
}
