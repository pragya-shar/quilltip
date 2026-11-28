/**
 * Ruled rows, label left and figure right in tabular figures, for what a
 * request will do: From, Network fee, Your balance after.
 */
export function Rows({
  rows,
}: {
  rows: { label: string; value: string; spoken?: string; show?: boolean }[]
}) {
  return (
    <dl className="qt-add__facts">
      {rows
        .filter((row) => row.show !== false)
        .map((row) => (
          <div key={row.label} className="qt-add__fact">
            <dt>{row.label}</dt>
            <dd aria-label={row.spoken}>{row.value}</dd>
          </div>
        ))}
    </dl>
  )
}
