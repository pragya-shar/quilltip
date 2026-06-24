import {
  Edit3,
  DollarSign,
  Shield,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { LANDING_FEATURE_COPY } from '@/lib/copy/landing-sections'

export interface LandingFeature {
  icon: LucideIcon
  title: string
  description: string
  href: string
}

const FEATURE_ICONS: LucideIcon[] = [MessageSquare, DollarSign, Edit3, Shield]

export const LANDING_FEATURES: LandingFeature[] = LANDING_FEATURE_COPY.map(
  (feature, index) => {
    const icon = FEATURE_ICONS[index]
    if (!icon) {
      throw new Error(`Missing feature icon for index ${index}`)
    }
    return {
      ...feature,
      icon,
    }
  }
)
