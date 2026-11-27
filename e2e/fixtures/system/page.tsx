import { createRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import '../../../system/gallery/gallery.css'
import './fixture.css'
import { Gallery } from '../../../system/gallery/Gallery'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { AppShell } from '../../../shell/AppShell'
import SampleReadingPage from '../../../app/(app)/(public)/system/reading/page'

// The design system gallery and the sample reading page inside the real
// application shell, with no backend: what e2e/system-*.spec.ts drives.
const page =
  location.pathname === '/reading' ? <SampleReadingPage /> : <Gallery />

createRoot(document.getElementById('root')!).render(
  <AppShell beside={<ToastRegion />}>{page}</AppShell>
)
