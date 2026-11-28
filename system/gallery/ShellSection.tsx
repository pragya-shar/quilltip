'use client'

import { BalanceItem } from '@/shell/BalanceItem'
import { BalanceSourceContext, type BalanceReading } from '@/shell/balance'
import { GallerySection } from './GallerySection'
import { SignOutDemo } from './SignOutDemo'
import { Specimen } from './Specimen'

const STATES: [string, BalanceReading][] = [
  [
    'Signed in, known',
    {
      auth: 'signed-in',
      available: { cents: 1840, display: '$18.40' },
      status: 'ready',
    },
  ],
  [
    'Signed in, loading',
    { auth: 'signed-in', available: null, status: 'loading' },
  ],
  [
    'Signed in, payments down',
    { auth: 'signed-in', available: null, status: 'unavailable' },
  ],
  [
    'Signed out',
    { auth: 'signed-out', available: null, status: 'unavailable' },
  ],
]

/** The bar's balance item in each state; a press opens the Pocket. */
export function ShellSection() {
  return (
    <GallerySection
      id="shell"
      title="The balance item"
      note="The bar’s fourth item. It opens the Pocket over the page: a sheet on a phone, a panel on a desktop. Signed out, it reads Sign in."
    >
      {STATES.map(([name, reading]) => (
        <Specimen key={name} name={name}>
          <BalanceSourceContext.Provider value={() => reading}>
            <ul className="qt-navbar__list qt-gallery__bar">
              <li>
                <BalanceItem className="qt-navbar__item" />
              </li>
            </ul>
          </BalanceSourceContext.Provider>
        </Specimen>
      ))}
      <Specimen name="Sign out, with something it would strand">
        <SignOutDemo />
      </Specimen>
      <Specimen name="Sign out, when a check fails or runs late">
        <SignOutDemo broken />
      </Specimen>
    </GallerySection>
  )
}
