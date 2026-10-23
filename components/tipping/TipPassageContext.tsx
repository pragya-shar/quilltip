export function TipPassageContext({ text }: { text: string }) {
  return (
    <blockquote
      className="tip-passage"
      // Keyboard users need to scroll passages that exceed the preview height.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label="Selected passage"
    >
      {text}
    </blockquote>
  )
}
