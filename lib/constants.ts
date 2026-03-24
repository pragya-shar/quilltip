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
export const EDITOR_PROSE_CLASS = 'prose prose-lg max-w-none focus:outline-none'
