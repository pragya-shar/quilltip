export type ArticleOverlayDismissActions = {
  closeCreatePopover: () => void
  closeDetailsPanel: () => void
  closeSignInPrompt?: () => void
}

/** Marks an overlay a press on which keeps the chosen passage open. */
export const ARTICLE_OVERLAY_ATTR = 'data-article-overlay'

/**
 * Dismisses highlight overlays when the user presses on the article surface.
 * Ignores presses inside an open dialog (create popover or details panel)
 * or inside a marked overlay (the passage tip bar).
 */
export function handleArticleHighlightOverlayPointerDown(
  target: EventTarget | null,
  actions: ArticleOverlayDismissActions
): void {
  if (
    (target as HTMLElement | null)?.closest(
      `[role="dialog"], [${ARTICLE_OVERLAY_ATTR}]`
    )
  )
    return
  actions.closeCreatePopover()
  actions.closeDetailsPanel()
  actions.closeSignInPrompt?.()
}
