import { WriterIntroduction } from '@/components/demos/WriterIntroduction'
// Landing styles load only where the landing look is used, not site-wide.
import '@/components/landing/landing-blend.css'
import '@/components/demos/writer-introduction.css'

export default function WriterDemoPage() {
  return <WriterIntroduction />
}
