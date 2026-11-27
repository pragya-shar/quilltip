import { TAB_TIP_DIALOG } from '@/lib/copy/tab'

/**
 * One line while the tip dialog's tab section loads: the height of the
 * "no tab" line, so the wallet button below does not move for most readers.
 */
export function TabTipDialogSkeleton() {
  return (
    <p className="tip-tab-line tip-tab-loading" role="status">
      <span className="sr-only">{TAB_TIP_DIALOG.loading}</span>
      <span aria-hidden="true" />
    </p>
  )
}
