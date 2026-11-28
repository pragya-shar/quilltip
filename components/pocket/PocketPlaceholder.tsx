import './pocket.css'
import { MoneyFigure } from '@/system/components/MoneyFigure'

/**
 * The balance before anything about it is known: one figure's space, with
 * no words that belong to a signed-in person. The balance shows the same
 * while auth loads, so nothing moves when it arrives.
 */
export function PocketPlaceholder() {
  return (
    <div
      className="qt-pocket"
      data-auth="loading"
      aria-busy="true"
      aria-label="Loading"
    >
      <MoneyFigure value={null} status="loading" size="xl" />
    </div>
  )
}
