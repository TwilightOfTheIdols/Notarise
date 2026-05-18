type TextSizeWheelPickerProps = {
  x: number
  y: number
  height: number
  rotation: number
}

export function TextSizeWheelPicker({ x, y, height, rotation }: TextSizeWheelPickerProps) {
  const tickCount = 18
  const aspectRatio = 4
  const radius = height * 1.43
  const tickHeight = height * 0.5
  const tickWidth = Math.max(1, height * 0.054)

  return (
    <div
      className="text-size-wheel-picker"
      style={{
        left: x,
        top: y,
        width: height * aspectRatio,
        height,
        borderRadius: height * 0.32,
        perspective: height * 6.8,
        transform: 'translate(-50%, -50%)',
      }}
      aria-hidden="true"
    >
      <div className="text-size-wheel-stage">
        {Array.from({ length: tickCount }, (_, index) => {
          const theta = index * (360 / tickCount) + rotation
          const radians = theta * (Math.PI / 180)
          const front = Math.max(0, Math.cos(radians))
          const isMajorTick = index % 3 === 0

          return (
            <i
              key={index}
              className={isMajorTick ? 'is-major' : undefined}
              style={{
                width: tickWidth,
                height: tickHeight,
                opacity: front,
                transform: `translate(-50%, -50%) rotateY(${theta}deg) translateZ(${radius}px) scaleY(${0.62 + front * 0.38})`,
                zIndex: Math.round(front * 100),
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
