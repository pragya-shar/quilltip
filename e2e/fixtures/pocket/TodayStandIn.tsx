import { Heading } from '../../../system/components/Heading'

// A place with enough text to scroll, standing in for Today: the Pocket
// must open over it and give back its scroll position and focus.
const paragraphs = Array.from(
  { length: 24 },
  (_, i) =>
    `Paragraph ${i + 1}. The kettle clicked off and nobody moved, because the light on the table was the only warm thing in the room and none of us wanted to be the first to leave it.`
)

export function TodayStandIn() {
  return (
    <div className="qt-page" data-fixture="today">
      <Heading level={1} variant="title">
        Today
      </Heading>
      {paragraphs.map((text, i) => (
        <p key={i} id={`p-${i + 1}`}>
          {text}
        </p>
      ))}
    </div>
  )
}
