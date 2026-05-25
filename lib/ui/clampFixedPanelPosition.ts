export interface PanelAnchor {
  top: number
  left: number
}

export interface PanelSize {
  width: number
  height: number
}

export interface ClampedPanelPosition {
  top: number
  left: number
}

const DEFAULT_MARGIN = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Computes top-left coordinates for a fixed panel anchored at top-center
 * of the selection, keeping the full panel inside the viewport.
 */
export function clampFixedPanelPosition(
  anchor: PanelAnchor,
  size: PanelSize,
  viewport: { width: number; height: number },
  margin = DEFAULT_MARGIN
): ClampedPanelPosition {
  const { width, height } = size
  const desiredLeft = anchor.left - width / 2
  const minLeft = margin
  const maxLeft = viewport.width - margin - width
  const left = clamp(desiredLeft, minLeft, Math.max(minLeft, maxLeft))

  const desiredTop = anchor.top
  const minTop = margin
  const maxTop = viewport.height - margin - height
  const top = clamp(desiredTop, minTop, Math.max(minTop, maxTop))

  return { top, left }
}
