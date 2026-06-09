import type { FontSizeRowLabel } from '../app/types'

type FontSizeRowLabelsProps = {
  isExiting: boolean
  labels: FontSizeRowLabel[]
}

export function FontSizeRowLabels({ isExiting, labels }: FontSizeRowLabelsProps) {
  return (
    <div
      className={`font-size-row-labels ${isExiting ? 'is-exiting' : ''}`}
      aria-hidden="true"
    >
      {labels.map((label) => (
        <span
          key={label.id}
          className="font-size-row-label"
          style={{
            left: label.x,
            top: label.y,
          }}
        >
          {label.size}
        </span>
      ))}
    </div>
  )
}
