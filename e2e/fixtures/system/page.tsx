import { createRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import '../../../system/gallery/gallery.css'
import './fixture.css'
import { Gallery } from '../../../system/gallery/Gallery'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { AppShell } from '../../../shell/AppShell'
import { SheetHost } from '../../../shell/SheetHost'
import {
  BalanceSourceContext,
  type BalanceReading,
} from '../../../shell/balance'
import SampleReadingPage from '../../../app/(app)/(public)/system/reading/page'
import ShelfPage from '../../../app/(app)/(public)/shelf/page'
import PocketPage from '../../../app/(app)/(signed-in)/pocket/page'
import { registerSheet } from '../../../shell/sheetRegistry'
import { SIGN_IN_SHEET } from '../../../shell/signIn'
import { DemoSignInSheet } from './DemoSignInSheet'
import { SheetsPage } from './SheetsPage'
import { setPocketLoader } from '../../../shell/pocket/loadPocket'
import { PocketContent } from '../../../components/pocket/PocketContent'

// The design system gallery, the sample reading page and the shell's own
// pages inside the real application shell, with no backend: what
// e2e/system-*.spec.ts drives. `?balance=` picks the balance source:
// ready (default), converted, loading, unavailable, signed-out, and
// auth-loading (who is here is not known yet).
const readings: Record<string, BalanceReading> = {
  ready: {
    auth: 'signed-in',
    available: { cents: 1840, display: '$18.40' },
    status: 'ready',
  },
  converted: {
    auth: 'signed-in',
    available: { cents: 1840, display: '$18.40', converted: true },
    status: 'ready',
  },
  loading: { auth: 'signed-in', available: null, status: 'loading' },
  unavailable: { auth: 'signed-in', available: null, status: 'unavailable' },
  'signed-out': { auth: 'signed-out', available: null, status: 'unavailable' },
  'auth-loading': { auth: 'loading', available: null, status: 'unavailable' },
}
const reading =
  readings[new URLSearchParams(location.search).get('balance') ?? 'ready'] ??
  readings.ready!
const useFakeBalance = () => reading
// `?pocket=fail`: the balance's code fails to load until the test sets
// `window.__pocketLoads = true` (warming on hover also fails meanwhile).
if (new URLSearchParams(location.search).get('pocket') === 'fail') {
  setPocketLoader(() =>
    (window as unknown as { __pocketLoads?: boolean }).__pocketLoads
      ? Promise.resolve({ default: PocketContent })
      : Promise.reject(new Error('offline'))
  )
}
// `?signin=sheet`: a stand-in for the Account surface's sign-in sheet.
if (new URLSearchParams(location.search).get('signin') === 'sheet')
  registerSheet(SIGN_IN_SHEET, DemoSignInSheet)

const pages: Record<string, () => React.ReactNode> = {
  '/': () => <Gallery />,
  '/reading': () => <SampleReadingPage />,
  '/shelf': () => <ShelfPage />,
  '/pocket': () => <PocketPage />,
  '/sheets': () => <SheetsPage />,
}
const Page = pages[location.pathname] ?? pages['/']!

// What the root layout writes from system/fonts.ts, with the fixture's
// family names (fixture.css).
document.documentElement.dataset.readingFaces = JSON.stringify({
  pairs: {
    latin: {
      first: "'Literata Fixture'",
      next: "'Literata Fixture Next'",
      italic: false,
    },
    latinItalic: {
      first: "'Literata Fixture Italic'",
      next: "'Literata Fixture Italic Next'",
      italic: true,
    },
    extended: {
      first: "'Literata Fixture Ext'",
      next: "'Literata Fixture Ext Next'",
      italic: false,
    },
    extendedItalic: {
      first: "'Literata Fixture Ext Italic'",
      next: "'Literata Fixture Ext Italic Next'",
      italic: true,
    },
  },
  lists: {
    '--qt-face-read': ['latin', 'extended', 'Quilltip Read Fallback'],
    '--qt-face-read-italic': [
      'latinItalic',
      'extendedItalic',
      'Quilltip Read Italic Fallback',
    ],
  },
})

createRoot(document.getElementById('root')!).render(
  <BalanceSourceContext.Provider value={useFakeBalance}>
    <AppShell
      beside={
        <>
          <SheetHost />
          <ToastRegion />
        </>
      }
    >
      <Page />
    </AppShell>
  </BalanceSourceContext.Provider>
)
