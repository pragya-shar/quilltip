/**
 * Article and writer links do not prefetch (#630). Their pages are dynamic
 * and have no loading boundary, so a prefetch fetched almost nothing a click
 * could reuse (#597), while every prefetch ran the proxy's route check and
 * rendered the page, which cost backend reads per card in view. A click
 * still costs one route check and at most one article read.
 */
export const ARTICLE_LINK_PREFETCH = false
