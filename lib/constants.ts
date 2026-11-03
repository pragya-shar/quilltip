// Tip limits (cents)
export const TIP_MIN_CENTS = 1
export const TIP_MIN_USD = TIP_MIN_CENTS / 100
export const TIP_MAX_CENTS = 10_000
export const TIP_MAX_USD = TIP_MAX_CENTS / 100

// Withdrawal
export const MIN_WITHDRAWAL_USD = 10

export const TIP_XLM_PRESETS = [1, 2, 5] as const
export type TipXlmPreset = (typeof TIP_XLM_PRESETS)[number]

// Editor content styling (prose class for Tiptap)
export const EDITOR_PROSE_CLASS =
  'prose prose-lg max-w-none focus:outline-none dark:prose-invert'

/** Visible focus ring for upload controls (file pickers, drop zones, file labels). */
export const UPLOAD_CONTROL_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background'

// Shared by both published rendering paths; editor styling stays independent.
export const PUBLISHED_PROSE_CLASS = EDITOR_PROSE_CLASS + ' published-prose'
