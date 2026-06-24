export function tipDialogTitle(authorName: string): string {
  return `Support ${authorName}`
}

export function tipDialogDescription(): string {
  return 'Show your appreciation with a tip for their work.'
}

// Same title as tipDialogTitle today; kept separate so highlight-specific
// phrasing can diverge without touching TipButton.
export function tipHighlightDialogTitle(authorName: string): string {
  return `Support ${authorName}`
}

export function tipHighlightDialogDescription(authorName: string): string {
  return `Tip ${authorName} for this specific insight.`
}
