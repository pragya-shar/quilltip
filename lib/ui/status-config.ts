/**
 * Shared status chip/panel class maps (ENG-262).
 * Use for Arweave, transfer, system status — not for primary CTAs.
 */
export const statusVariants = {
  pending: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  success: 'bg-success text-success-foreground',
  error: 'bg-destructive/10 text-destructive',
} as const

export type StatusVariant = keyof typeof statusVariants
