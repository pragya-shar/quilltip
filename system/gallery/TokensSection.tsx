import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'

const COLORS = [
  ['paper', 'Page ground'],
  ['surface', 'Cards, sheets'],
  ['sunk', 'Chips, fills'],
  ['line', 'Hairlines'],
  ['line-strong', 'Control borders'],
  ['ink', 'Text'],
  ['ink-2', 'Secondary text'],
  ['ink-3', 'Meta text'],
  ['marker', 'Tipped line, sent'],
  ['marker-soft', 'Heat 2'],
  ['marker-faint', 'Heat 1'],
  ['marker-ink', 'Money in'],
  ['action-bg', 'Primary action'],
  ['danger', 'Failure only'],
  ['danger-soft', 'Failure panel'],
  ['focus', 'Focus ring'],
  ['toast-bg', 'Toasts'],
] as const

const TYPE = [
  ['display', 'read', 'What my grandmother’s ledger taught me'],
  ['title', 'read', 'Add money'],
  ['line', 'read', 'She wrote down every coin she ever gave away.'],
  [
    'read',
    'read',
    'For thirty years she wrote one line each time she gave something away.',
  ],
  ['ui-l', 'ui', 'Tip $1 · Row titles'],
  ['ui', 'ui', 'Default interface text'],
  ['ui-s', 'ui', 'Meta and captions · 9:38'],
  ['ui-xs', 'ui', 'Testnet. Practice money only.'],
] as const

const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 14] as const
const RADII = ['tag', 'control', 'card', 'sheet', 'pill'] as const
const SHADOWS = ['card', 'float', 'sheet'] as const
const MOTION = [
  ['press', '120ms'],
  ['quick', '160ms'],
  ['base', '220ms'],
  ['sheet', '260ms in, 200ms out'],
  ['stroke', '320ms, the marker'],
] as const

/** Every token, drawn from the live custom properties. */
export function TokensSection() {
  return (
    <GallerySection
      id="tokens"
      title="Tokens"
      note="Values come from system/tokens.css; switch the theme to see the dark values."
    >
      <Specimen name="Color" wide>
        <ul className="qt-gallery__swatches">
          {COLORS.map(([token, use]) => (
            <li key={token} className="qt-gallery__swatch">
              <span
                className="qt-gallery__chip"
                style={{ background: `var(--qt-${token})` }}
              />
              <code>--qt-{token}</code>
              <span>{use}</span>
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen name="Type" wide>
        <ul className="qt-gallery__type">
          {TYPE.map(([size, face, sample]) => (
            <li key={size}>
              <code>{size}</code>
              <span
                style={{
                  fontFamily: `var(--qt-font-${face})`,
                  fontSize: `var(--qt-text-${size})`,
                  lineHeight: `var(--qt-lh-${size})`,
                  fontWeight:
                    size === 'display' || size === 'title' ? 650 : undefined,
                  letterSpacing:
                    size === 'display' ? 'var(--qt-track-display)' : undefined,
                }}
              >
                {sample}
              </span>
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen name="Space (4 px base)">
        <ul className="qt-gallery__bars">
          {SPACE.map((step) => (
            <li key={step}>
              <code>{step}</code>
              <span style={{ inlineSize: `var(--qt-space-${step})` }} />
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen name="Radii">
        <ul className="qt-gallery__shapes">
          {RADII.map((radius) => (
            <li key={radius}>
              <span style={{ borderRadius: `var(--qt-radius-${radius})` }} />
              <code>{radius}</code>
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen name="Elevation">
        <ul className="qt-gallery__shapes">
          {SHADOWS.map((shadow) => (
            <li key={shadow}>
              <span
                data-surface=""
                style={{ boxShadow: `var(--qt-shadow-${shadow})` }}
              />
              <code>{shadow}</code>
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen name="Motion">
        <ul className="qt-gallery__list">
          {MOTION.map(([name, value]) => (
            <li key={name}>
              <code>{name}</code> {value}
            </li>
          ))}
          <li>
            <code>reduced motion</code> every duration ends at once
          </li>
        </ul>
      </Specimen>
    </GallerySection>
  )
}
