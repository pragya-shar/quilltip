import type { ReactNode } from 'react'

/** A group of specimens with a heading the gallery's index links to. */
export function GallerySection({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section
      className="qt-gallery__section"
      id={id}
      aria-labelledby={`${id}-title`}
    >
      <h2 className="qt-gallery__title" id={`${id}-title`}>
        {title}
      </h2>
      {note ? <p className="qt-gallery__note">{note}</p> : null}
      <div className="qt-gallery__grid">{children}</div>
    </section>
  )
}
