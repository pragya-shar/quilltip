import type { ReactNode } from 'react'

/** One labelled example in the gallery: the state's name, then the thing. */
export function Specimen({
  name,
  wide,
  children,
}: {
  name: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <figure
      className="qt-gallery__specimen"
      data-wide={wide || undefined}
      data-specimen={name}
    >
      <figcaption className="qt-gallery__state">{name}</figcaption>
      <div className="qt-gallery__stage">{children}</div>
    </figure>
  )
}
