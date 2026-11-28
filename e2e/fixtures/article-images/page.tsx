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
import { UserAvatar } from '../../../components/ui/user-avatar'
import { createReaderYoutubeNode } from '../../../lib/tiptap/youtubeEmbed'
import { createYoutubeExtension } from '../../../lib/tiptap/youtubeExtension'
import '../../../components/articles/reader.css'
import '../../../components/editor/writing-workspace.css'
import { AVATARS, article } from './article'

function Fixture() {
  // The highlight view's image node (HighlightableArticle), read-only.
  const highlight = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      ResizableImage,
      createReaderYoutubeNode(),
    ],
    content: article,
    editable: false,
    immediatelyRender: false,
  })
  // The writing workspace's image node (useWritingWorkspace).
  const writer = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      WritingImage,
      createYoutubeExtension(),
    ],
    content: article,
    immediatelyRender: false,
  })
  const [dialog, setDialog] = useState(false)
  const [videoDialog, setVideoDialog] = useState(false)
  const workspace = {
    showBodyImageDialog: dialog,
    showCoverImageDialog: false,
    showBodyYouTubeDialog: videoDialog,
    setShowBodyImageDialog: setDialog,
    setShowCoverImageDialog: () => {},
    setShowBodyYouTubeDialog: setVideoDialog,
    setCoverImage: () => {},
    setHasUnsavedChanges: () => {},
    editor: writer,
  }
  return (
    <>
      <section data-reader="avatars">
        <h2>Profile photos</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          {Object.entries(AVATARS).map(([kind, src]) => (
            <span key={kind} data-avatar={kind}>
              <UserAvatar
                src={src}
                alt={`Writer ${kind}`}
                name={`Writer ${kind}`}
                className="size-12"
              />
            </span>
          ))}
        </div>
      </section>
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
        {/* As the workspace wraps it (WritingWorkspaceView). */}
        <div className="writer-body">
          <EditorContent editor={writer} />
        </div>
        <button type="button" onClick={() => setDialog(true)}>
          Add an image
        </button>
        <button type="button" onClick={() => setVideoDialog(true)}>
          Add a video
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
