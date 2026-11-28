import { ReadingRoomShell } from '@/components/articles/ReadingRoomShell'
import { ReadingRoomPage } from '@/components/articles/ReadingRoomPage'
import {
  readingRoomListArgs,
  readingRoomListKey,
} from '@/lib/articles/readingRoomListArgs'
import { searchParamsRecordReader } from '@/lib/auth/safeReturnPath'
import { getReadingRoomList } from '@/lib/seo/publicContent'
import { retryHrefFor } from '@/components/articles/ReadingUnavailable'
import { preloadUiFont } from '@/lib/fonts/preloadFonts'
import { listArticleForClient } from '@/lib/articles/listArticleForClient'
import '@/components/articles/reading-room.css'

/**
 * Renders the first article list on the server, so the first HTML already
 * shows the cards and their cover images are found without waiting for the
 * page script. The live query takes over in the browser.
 */
export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  preloadUiFont()
  const query = await searchParams
  const params = searchParamsRecordReader(query)
  const args = readingRoomListArgs(params)
  // Bookmarks and search load in the browser by design; only the plain list
  // is read here.
  const readsOnServer = params.get('bookmarked') !== '1' && !args.search
  const list = readsOnServer ? await getReadingRoomList(args) : undefined
  // Cards need each article's opening, not its whole body.
  const initialList =
    list &&
    ({
      ...list,
      articles: list.articles.map(listArticleForClient),
    } as typeof list)

  return (
    <ReadingRoomShell>
      <ReadingRoomPage
        initialList={initialList}
        initialListKey={initialList ? readingRoomListKey(args) : undefined}
        unavailableRetryHref={
          readsOnServer && list === undefined
            ? retryHrefFor('/articles', query)
            : undefined
        }
      />
    </ReadingRoomShell>
  )
}
