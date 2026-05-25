// Tip limits (cents)
export const TIP_MIN_CENTS = 1
export const TIP_MIN_USD = TIP_MIN_CENTS / 100
export const TIP_MAX_CENTS = 10_000
export const TIP_MAX_USD = TIP_MAX_CENTS / 100

// Withdrawal
export const MIN_WITHDRAWAL_USD = 10

// Presets: article tips (higher) vs highlight tips (lower)
export const TIP_PRESETS_ARTICLE = [
  { cents: 100, label: '$1', popular: false },
  { cents: 500, label: '$5', popular: true },
  { cents: 1000, label: '$10', popular: false },
] as const

export const TIP_PRESETS_HIGHLIGHT = [
  { cents: 10, label: '10¢', popular: false },
  { cents: 50, label: '50¢', popular: true },
  { cents: 100, label: '$1', popular: false },
] as const

// Editor content styling (prose class for Tiptap)
export const EDITOR_PROSE_CLASS =
  'prose prose-lg max-w-none focus:outline-none dark:prose-invert'

/** Visible focus ring for upload controls (file pickers, drop zones, file labels). */
export const UPLOAD_CONTROL_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background'
