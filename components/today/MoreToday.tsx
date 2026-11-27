import Link from 'next/link'
import { Avatar } from '@/system/components/Avatar'
import { Heading } from '@/system/components/Heading'
import type { TodayMoreItem } from './types'

/**
 * More to read after the opening: a short list that ends. Each item says
 * what it is (title, first sentence, writer, minutes) and has one plain
 * Read more link that covers the item, so a tap anywhere opens it.
 */
export function MoreToday({ items }: { items: TodayMoreItem[] }) {
  return (
    <section className="qt-today__more" aria-labelledby="today-more">
      <Heading level={2} variant="section" id="today-more">
        More today
      </Heading>
      <ul className="qt-today__list">
        {items.map((item) => (
          <li key={item.articleId} className="qt-today__item">
            <Heading level={3} variant="title" className="qt-today__item-title">
              {item.title}
            </Heading>
            <p className="qt-today__item-first">{item.first}</p>
            <p className="qt-today__item-meta">
              <Avatar name={item.author.name} size={24} decorative />
              <span className="qt-today__item-by">
                {item.author.name}
                <span aria-hidden="true"> · </span>
                <span className="qt-visually-hidden">, </span>
                {item.readMinutes} min
              </span>
              <Link
                href={item.href}
                className="qt-today__item-link"
                aria-label={`Read more: ${item.title}`}
              >
                Read more
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
