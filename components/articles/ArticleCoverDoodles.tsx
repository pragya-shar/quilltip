import type { ReactNode } from 'react'
import type { ArticleForDisplay } from '@/types/index'

// Curated by the existing public article identity, never by list position or title.
const storyThemes = {
  'chris/untitled': 'architecture',
  'chris/traveling-in-vietnam': 'vietnam',
  'anu/the-pyramids-of-giza-history-culture': 'pyramids',
  'anu/untitled-1774208584358': 'london',
  'anu/untitled': 'steam',
  'pragya/untitled-1774206339845': 'serenity',
  'jess/untitled-1774206080855': 'galaxy',
  'jess/untitled-1774205793966': 'bloom',
  'jess/untitled': 'sunset',
  'anu/photography': 'photography',
  'anu/pictures': 'memories',
} as const

type Theme = (typeof storyThemes)[keyof typeof storyThemes] | 'writing'

const drawings: Record<Theme, ReactNode> = {
  architecture: (
    <path d="M29 17h49v7H29ZM35 24l-2 36m39-36 2 36M45 29v26m17-26v26M28 61h51v7H28Z" />
  ),
  vietnam: (
    <path d="M55 7v10M43 18h24M43 22C20 32 28 54 43 60h24c17-8 22-29 0-38ZM46 24q-10 17 0 33m18-33q10 17 0 33M44 64h22m-11 0v10" />
  ),
  pyramids: (
    <path d="M9 63 34 18l26 45ZM34 18l8 45m8-18 18-17 23 35H60m24-11 13-13 13 24H91" />
  ),
  london: (
    <>
      <path d="M34 69V29h38v40M40 29V19h26v10M45 19l8-12 8 12M30 69h46M46 56v7m14-7v7" />
      <circle cx="53" cy="41" r="8" />
      <path d="M53 36v5l4 2" />
    </>
  ),
  steam: (
    <>
      <path d="M19 56V36h39V23h24v33ZM26 36V25h9v11M54 23h32M65 31h9v11h-9M16 57h73M30 18q-7-5 1-10" />
      <circle cx="32" cy="63" r="7" />
      <circle cx="70" cy="63" r="7" />
    </>
  ),
  serenity: (
    <path d="M30 68Q50 45 76 15M46 50C26 49 26 33 27 30c15 1 22 9 19 20ZM58 36c14 4 26-5 28-16-15-1-25 5-28 16Z" />
  ),
  galaxy: (
    <>
      <ellipse cx="56" cy="40" rx="5" ry="3" />
      <path d="M60 37c-12-13-37-3-31 10 8 17 54 1 54-12 0-19-54-14-70 6M52 43c12 13 37 3 31-10-8-17-54-1-54 12 0 19 54 14 70-6" />
    </>
  ),
  bloom: (
    <>
      <path d="M55 47v26m0-12q-17-1-17-12 15 0 17 12M48 24c-6-20 20-20 14 0 20-6 28 16 8 19 3 21-22 23-25 3-21 4-26-20-6-23Z" />
      <circle cx="55" cy="34" r="6" />
    </>
  ),
  sunset: (
    <path d="M30 45a25 25 0 0 1 50 0M17 49h77M30 60h50M55 11V5M27 22l-6-5m62 5 6-5" />
  ),
  photography: (
    <>
      <path d="M18 28h23l5-10h20l6 10h21v36H18ZM79 36h6" />
      <circle cx="55" cy="46" r="12" />
    </>
  ),
  memories: (
    <>
      <path d="m31 10 51 7-8 55-51-7ZM36 18l38 5-5 32-38-5Z" />
      <circle cx="53" cy="32" r="6" />
      <path d="M40 47q4-13 12-8 8 1 9 11" />
    </>
  ),
  writing: <path d="M53 13q-2 21-23 27 21 2 26 25 2-23 23-28-21-3-26-24Z" />,
}

export function ArticleCoverDoodles({
  article,
}: {
  article: Pick<ArticleForDisplay, 'slug' | 'author'>
}) {
  const identity = `${article.author.username}/${article.slug}`.toLowerCase()
  const theme = Object.prototype.hasOwnProperty.call(storyThemes, identity)
    ? storyThemes[identity as keyof typeof storyThemes]
    : 'writing'

  return (
    <span className="cover-doodles" data-theme={theme} aria-hidden="true">
      <svg
        className="cover-doodle"
        viewBox="0 0 112 80"
        fill="none"
        focusable="false"
      >
        {drawings[theme]}
      </svg>
    </span>
  )
}
