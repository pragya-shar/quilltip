import { ReadingRoomShell } from '@/components/articles/ReadingRoomShell'
import { ReadingRoomPage } from '@/components/articles/ReadingRoomPage'
import {
  readingRoomListArgs,
  readingRoomListKey,
} from '@/lib/articles/readingRoomListArgs'
import { searchParamsRecordReader } from '@/lib/auth/safeReturnPath'
import { getReadingRoomList } from '@/lib/seo/publicContent'
import { preloadUiFont } from '@/lib/fonts/preloadFonts'
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
  const params = searchParamsRecordReader(await searchParams)
  const args = readingRoomListArgs(params)
  const initialList =
    params.get('bookmarked') === '1'
      ? undefined
      : await getReadingRoomList(args)

  return (
    <ReadingRoomShell>
      <ReadingRoomPage
        initialList={initialList}
        initialListKey={initialList ? readingRoomListKey(args) : undefined}
      />
    </ReadingRoomShell>
  )
}
