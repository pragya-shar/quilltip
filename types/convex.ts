import type { FunctionReturnType } from 'convex/server'
import { api } from '@/convex/_generated/api'

export type { Doc, Id } from '@/convex/_generated/dataModel'

export type CurrentUser = FunctionReturnType<typeof api.users.getCurrentUser>
export type CurrentUserDoc = NonNullable<CurrentUser>

export type PublicProfileUser = NonNullable<
  FunctionReturnType<typeof api.users.getUserByUsername>
>

export type UserStats = NonNullable<
  FunctionReturnType<typeof api.users.getUserStats>
>

export type ListArticlesResult = FunctionReturnType<
  typeof api.articles.listArticles
>
export type ListArticleRow = ListArticlesResult['articles'][number]

export type ArticleBySlug = NonNullable<
  FunctionReturnType<typeof api.articles.getArticleBySlug>
>

export type ArticleById = NonNullable<
  FunctionReturnType<typeof api.articles.getArticleById>
>

export type UserDrafts = FunctionReturnType<
  typeof api.articles.getUserDrafts
>

export type NFTByArticleResult = FunctionReturnType<
  typeof api.nfts.getNFTByArticle
>

export type ArticleTipStats = FunctionReturnType<
  typeof api.tips.getArticleTipStats
>

export type AuthorEarnings = FunctionReturnType<
  typeof api.tips.getAuthorEarnings
>

export type UserReceivedTips = FunctionReturnType<
  typeof api.tips.getUserReceivedTips
>

export type NFTsByOwnerResult = FunctionReturnType<
  typeof api.nfts.getNFTsByOwner
>

export type UserMintedNFTsResult = FunctionReturnType<
  typeof api.nfts.getUserMintedNFTs
>

export type ArticleHighlights = FunctionReturnType<
  typeof api.highlights.getArticleHighlights
>

export type HighlightTipsForHighlight = FunctionReturnType<
  typeof api.highlightTips.getByHighlight
>

export type ArticleHighlightTipStats = FunctionReturnType<
  typeof api.highlightTips.getArticleStats
>

export type UserHighlightsResult = FunctionReturnType<
  typeof api.highlights.getUserHighlights
>
