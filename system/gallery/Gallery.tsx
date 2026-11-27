import { Heading } from '../components/Heading'
import { Text } from '../components/Text'
import { ActionsSection } from './ActionsSection'
import { FormsSection } from './FormsSection'
import { ListsSection } from './ListsSection'
import { MoneySection } from './MoneySection'
import { OverlaysSection } from './OverlaysSection'
import { ReadingSection } from './ReadingSection'
import { ThemeSwitch } from './ThemeSwitch'
import { TokensSection } from './TokensSection'

const INDEX = [
  ['tokens', 'Tokens'],
  ['actions', 'Buttons'],
  ['money', 'Money'],
  ['overlays', 'Overlays'],
  ['lists', 'Rows'],
  ['forms', 'Fields'],
  ['reading', 'Reading'],
] as const

/**
 * The design system in one page: every token and every component in every
 * state. The reference surface builders use and the page the system tests
 * drive. Sample data only; nothing here reads or moves money.
 */
export function Gallery() {
  return (
    <div className="qt-gallery">
      <header className="qt-gallery__head">
        <Heading level={1} variant="title">
          Design system
        </Heading>
        <Text as="p" tone="ink-2">
          Tokens and components of the Quilltip application. Not linked from the
          product.
        </Text>
        <ThemeSwitch />
        <nav aria-label="Gallery sections">
          <ul className="qt-gallery__index">
            {INDEX.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <TokensSection />
      <ActionsSection />
      <MoneySection />
      <OverlaysSection />
      <ListsSection />
      <FormsSection />
      <ReadingSection />
    </div>
  )
}
