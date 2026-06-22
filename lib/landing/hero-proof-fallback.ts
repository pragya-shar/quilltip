export const HERO_PROOF_SECTION_LABEL = 'Published stories'

export const HERO_PROOF_SCREENSHOT = {
  src: '/landing/hero-mobile-proof.webp',
  width: 358,
  height: 220,
  alt: 'Quilltip article reader with a highlighted passage and tip action',
} as const

export const HERO_PROOF_FALLBACK_CAPTION =
  'Read and tip published stories on Quilltip'

export type HeroProofMode = 'live' | 'screenshot'

export function resolveHeroProofMode(
  articleCount: number | undefined,
  isLoading: boolean
): HeroProofMode | 'loading' {
  if (isLoading || articleCount === undefined) return 'loading'
  return articleCount > 0 ? 'live' : 'screenshot'
}
