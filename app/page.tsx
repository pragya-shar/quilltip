import { LandingHome } from '@/components/landing/LandingHome'
import { preloadLandingFonts } from '@/lib/fonts/preloadFonts'

export default function HomePage() {
  preloadLandingFonts()
  return <LandingHome />
}
