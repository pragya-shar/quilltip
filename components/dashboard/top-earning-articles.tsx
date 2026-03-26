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
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-500" />
          Top Earning Articles
        </h3>
      </div>
      <div className="divide-y">
        {articles.slice(0, 5).map((article, index) => (
          <div key={article.articleId} className="p-4 hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-500">
                    #{index + 1}
                  </span>
                  <h4 className="font-medium text-gray-900">{article.title}</h4>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {article.tipCount} tips
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">
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
