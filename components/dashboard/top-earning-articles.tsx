'use client'

import { TrendingUp } from 'lucide-react'

export type TopArticleRow = {
  articleId: string
  title: string
  earnings: number
  tipCount: number
}

type TopEarningArticlesProps = {
  articles: TopArticleRow[]
}

export function TopEarningArticles({ articles }: TopEarningArticlesProps) {
  if (articles.length === 0) {
    return null
  }

  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-success-foreground" />
          Top Earning Articles
        </h3>
      </div>
      <div className="divide-y divide-border">
        {articles.slice(0, 5).map((article, index) => (
          <div key={article.articleId} className="p-4 hover:bg-muted/50">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    #{index + 1}
                  </span>
                  <h4 className="font-medium text-foreground">{article.title}</h4>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {article.tipCount} tips
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground">
                  ${article.earnings.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
