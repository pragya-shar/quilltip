import type { SheetDeclarations } from '../../../shell/sheets/types'

// Stands in for shell/sheets/signin.ts in the fixture build: with
// `?signin=sheet` a sign-in sheet is declared (a stand-in body, with no
// backend), so the signed-out balance item opens it over the page; without
// it no sign-in sheet exists, and the item follows its link.
const wanted =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('signin') === 'sheet'

export const sheets: SheetDeclarations = wanted
  ? {
      'sign-in': {
        title: 'Sign in to Quilltip',
        load: () => import('./DemoSignInBody'),
      },
    }
  : {}
