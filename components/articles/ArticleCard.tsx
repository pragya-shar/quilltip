import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ArticleForDisplay } from '@/types/index'

interface ArticleCardProps {
  article: ArticleForDisplay
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const publishedDate = article.publishedAt
    ? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
    : null

  return (
    <article className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-200">
      {/* Cover Image */}
      {article.coverImage && (
        <Link href={`/${article.author.username}/${article.slug}`}>
          <div className="h-48 w-full overflow-hidden">
            <img
              src={article.coverImage}
              alt={article.title}
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
            />
          </div>
        </Link>
      )}

      <div className="p-6">
        {/* Title */}
        <Link href={`/${article.author.username}/${article.slug}`}>
          <h2 className="text-xl font-bold text-gray-900 mb-2 hover:text-brand-blue transition-colors line-clamp-2">
            {article.title}
          </h2>
        </Link>

        {/* Excerpt */}
        {article.excerpt && (
          <p className="text-gray-600 mb-4 line-clamp-3">{article.excerpt}</p>
        )}

        {/* Tags */}
        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {article.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full"
              >
                {tag.name}
              </span>
            ))}
            {article.tags.length > 3 && (
              <span className="text-xs px-2 py-1 text-gray-500">
                +{article.tags.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Author Info */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <Link
            href={`/${article.author.username}`}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            {article.author.avatar ? (
              <Image
                src={article.author.avatar}
                alt={article.author.name || article.author.username}
                width={36}
                height={36}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold text-sm">
                {(article.author.name || article.author.username)
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-gray-900">
                {article.author.name || article.author.username}
              </p>
              <p className="text-xs text-gray-500">
                @{article.author.username}
              </p>
            </div>
          </Link>

          {/* Published Date */}
          {publishedDate && (
            <span className="text-xs text-gray-500">{publishedDate}</span>
          )}
        </div>
      </div>
    </article>
  )
}
