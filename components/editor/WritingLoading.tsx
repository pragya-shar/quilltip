'use client'
import Link from 'next/link'
import { WritingBrand } from './WritingBrand'

export function WritingLoading({
  message = 'Opening your writing desk…',
  retry,
}: {
  message?: string
  retry?: () => void
}) {
  return (
    <div className="writing-workspace">
      <header className="topbar">
        <WritingBrand />
      </header>
      <main>
        <div className="sheet">
          <p role="status">{message}</p>
          {retry && (
            <button className="wine" onClick={retry}>
              Try again
            </button>
          )}
          <Link className="editor-return" href="/articles">
            Back to articles
          </Link>
        </div>
      </main>
    </div>
  )
}
