/** Publication history survives administrative hiding and failed uploads. */
export function canDeleteDraft(article: {
  published: boolean
  publishedAt?: number
  arweaveStatus?: string
  arweaveTxId?: string
}) {
  return (
    !article.published &&
    article.publishedAt === undefined &&
    article.arweaveStatus === undefined &&
    article.arweaveTxId === undefined
  )
}
