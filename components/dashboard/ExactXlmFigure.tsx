import { Fragment } from 'react'
import { formatXlmFromStroops } from '@/lib/copy/network-status'

/**
 * A settled, server-summed XLM figure at full precision (#676). A long
 * figure breaks only after a thousands comma or the decimal point, so it
 * reflows at 200% zoom on a phone; the break points add no text, so it
 * reads as one number.
 */
export function ExactXlmFigure({
  stroops,
  figureClassName,
  unitClassName,
}: {
  stroops: string
  figureClassName?: string
  unitClassName?: string
}) {
  const figure = formatXlmFromStroops(stroops).replace(/ XLM$/, '')
  const [whole = '', fraction] = figure.split('.')
  return (
    <>
      <span className={figureClassName}>
        {whole.split(',').map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <>
                ,<wbr />
              </>
            ) : null}
            {group}
          </Fragment>
        ))}
        {fraction !== undefined ? (
          <>
            .<wbr />
            {fraction}
          </>
        ) : null}
      </span>{' '}
      <span className={unitClassName}>XLM</span>
    </>
  )
}
