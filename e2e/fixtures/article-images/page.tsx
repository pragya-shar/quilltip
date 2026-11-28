// The readers after scripts load, and the writing editor with its image
// dialog, for the article image fixture (#615).
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ArticleReadOnlyBody } from '../../../components/articles/ArticleReadOnlyBody'
import { ResizableImage } from '../../../components/editor/extensions/ResizableImage'
import { WritingImage } from '../../../components/editor/WritingImage'
import { WritingMedia } from '../../../components/editor/WritingMedia'
import { getArticleAppearance } from '../../../lib/editor/articleAppearance'
import '../../../components/articles/reader.css'
import '../../../components/editor/writing-workspace.css'
import { article } from './article'

function Fixture() {
  // The highlight view's image node (HighlightableArticle), read-only.
  const highlight = useEditor({
    extensions: [StarterKit.configure({ link: false }), ResizableImage],
    content: article,
    editable: false,
    immediatelyRender: false,
  })
  // The writing workspace's image node (useWritingWorkspace).
  const writer = useEditor({
    extensions: [StarterKit.configure({ link: false }), WritingImage],
    content: article,
    immediatelyRender: false,
  })
  const [dialog, setDialog] = useState(false)
  const workspace = {
    showBodyImageDialog: dialog,
    showCoverImageDialog: false,
    showBodyYouTubeDialog: false,
    setShowBodyImageDialog: setDialog,
    setShowCoverImageDialog: () => {},
    setShowBodyYouTubeDialog: () => {},
    setCoverImage: () => {},
    setHasUnsavedChanges: () => {},
    editor: writer,
  }
  return (
    <>
      <section data-reader="client" className="article-content">
        <h2>Client body</h2>
        <ArticleReadOnlyBody content={article} />
      </section>
      <section data-reader="highlight" className="article-content">
        <h2>Highlight view</h2>
        <div className="published-prose prose prose-stone">
          <EditorContent editor={highlight} />
        </div>
      </section>
      <section data-reader="writer" className="writing-workspace">
        <h2>Writing editor</h2>
        <EditorContent editor={writer} />
        <button type="button" onClick={() => setDialog(true)}>
          Add an image
        </button>
        <WritingMedia
          workspace={workspace as never}
          appearance={getArticleAppearance(article)}
          insertTrigger={{ current: null }}
        />
      </section>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
