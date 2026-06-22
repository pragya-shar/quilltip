export const LANDING_SECTION_IDS = [
  'features',
  'how-it-works',
  'security',
  'faq',
] as const

export type LandingSectionId = (typeof LANDING_SECTION_IDS)[number]

export const LANDING_NAV_HASHES = [
  '#features',
  '#how-it-works',
  '#faq',
  '#security',
] as const
