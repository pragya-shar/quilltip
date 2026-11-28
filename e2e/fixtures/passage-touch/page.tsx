import { createRoot } from 'react-dom/client'
import { HighlightableArticle } from '../../../components/articles/HighlightableArticle'
import '../../../components/articles/reader.css'
import type { Id } from '../../../types/convex'
import { ARTICLE, CONTENT } from './article'

// The article reader as on an article page, for a signed-out reader (#665).
createRoot(document.getElementById('root')!).render(
  <main
    className="reader-layout"
    style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 160px' }}
  >
    <h1 className="reader-title">{ARTICLE.title}</h1>
    <HighlightableArticle
      articleId={ARTICLE._id as Id<'articles'>}
      content={CONTENT}
    />
    <p>Below the article.</p>
  </main>
)
