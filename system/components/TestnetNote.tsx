import { cx } from '../cx'

/**
 * The one small testnet line on a screen that shows money or where money
 * enters. Said once per screen, at 12 px, under the figures.
 */
export function TestnetNote({
  children = 'Testnet. Practice money only.',
  className,
}: {
  children?: string
  className?: string
}) {
  return <p className={cx('qt-testnet', className)}>{children}</p>
}
