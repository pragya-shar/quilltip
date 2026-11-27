import { cx } from '../cx'

type SkeletonProps = {
  /** line: a line of text. block: an image or card. circle: an avatar. */
  shape?: 'line' | 'block' | 'circle'
  /** CSS width ("60%", "8rem"). Lines default to full width. */
  width?: string
  /** CSS height for blocks and circles. */
  height?: string
  className?: string
}

/**
 * Space held for content that is on its way, at its final size so nothing
 * moves when it arrives. Decorative: the region around it sets aria-busy and
 * a label. Never used above public reading content (D19); reading arrives in
 * the first response.
 */
export function Skeleton({
  shape = 'line',
  width,
  height,
  className,
}: SkeletonProps) {
  return (
    <span
      className={cx('qt-skeleton', className)}
      data-shape={shape}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}
