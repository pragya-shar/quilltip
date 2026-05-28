export type ArticleOverlayDismissActions = {
  closeCreatePopover: () => void
  closeDetailsPanel: () => void
  closeSignInPrompt?: () => void
}

/**
 * Dismisses highlight overlays when the user presses on the article surface.
 * Ignores presses inside an open dialog (create popover or details panel).
 */
export function handleArticleHighlightOverlayPointerDown(
  target: EventTarget | null,
  actions: ArticleOverlayDismissActions
): void {
  if ((target as HTMLElement | null)?.closest('[role="dialog"]')) return
  actions.closeCreatePopover()
  actions.closeDetailsPanel()
  actions.closeSignInPrompt?.()
}
