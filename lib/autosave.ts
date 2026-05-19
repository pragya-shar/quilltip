/** Idle delay before persisting draft changes to Convex. */
export const AUTO_SAVE_DEBOUNCE_MS = 10_000

export const AUTO_SAVE_DEBOUNCE_SECONDS = AUTO_SAVE_DEBOUNCE_MS / 1000

/** User-facing line for drafts help and editor tooltips. Keep in sync with AUTO_SAVE_DEBOUNCE_MS. */
export const AUTO_SAVE_GUIDANCE = `Drafts auto-save about ${AUTO_SAVE_DEBOUNCE_SECONDS} seconds after your last edit`
