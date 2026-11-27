import type { Redirect } from './types'

/**
 * Old public routes that Today replaced. /articles (the reading room) goes to
 * Today, or to search when it carried a query; /demo/write (the writer
 * introduction) goes to the editor.
 */
export const TODAY_REDIRECTS: readonly Redirect[] = [
  {
    from: '/articles',
    to: (url) => {
      const q = url.searchParams.get('q')?.trim()
      return q ? `/search?q=${encodeURIComponent(q)}` : '/'
    },
  },
  { from: '/demo/write', to: () => '/write' },
]
