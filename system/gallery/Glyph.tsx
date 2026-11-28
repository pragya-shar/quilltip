import { Icon, type IconGlyph } from '../components/Icon'

/** A round glyph in place of an avatar: money added, withdrawn. */
export function Glyph({ icon }: { icon: IconGlyph }) {
  return (
    <span className="qt-gallery__glyph" aria-hidden="true">
      <Icon icon={icon} size={20} />
    </span>
  )
}
