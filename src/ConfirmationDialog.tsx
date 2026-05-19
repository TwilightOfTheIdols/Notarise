import { useEffect, useRef, useState } from 'react'

export type ConfirmationRequest = {
  title: string
  message?: string
  confirmLabel: string
  onConfirm: () => void
}

type ConfirmationDialogProps = {
  request: ConfirmationRequest | null
  onCancel: () => void
  onConfirm: () => void
  fadeMs: number
}

export function ConfirmationDialog({ request, onCancel, onConfirm, fadeMs }: ConfirmationDialogProps) {
  const [displayedRequest, setDisplayedRequest] = useState<ConfirmationRequest | null>(request)
  const [isExiting, setIsExiting] = useState(false)
  const exitTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }

    if (request) {
      setDisplayedRequest(request)
      setIsExiting(false)
      return
    }

    if (displayedRequest) {
      setIsExiting(true)
      exitTimerRef.current = window.setTimeout(() => {
        setDisplayedRequest(null)
        setIsExiting(false)
        exitTimerRef.current = null
      }, fadeMs)
    }

    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [displayedRequest, fadeMs, request])

  const activeRequest = request ?? displayedRequest

  if (!activeRequest) {
    return null
  }

  return (
    <div
      className={`confirmation-backdrop ${isExiting ? 'is-exiting' : ''}`}
      role="presentation"
      onPointerDown={isExiting ? undefined : onCancel}
    >
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby={activeRequest.message ? 'confirmation-message' : undefined}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id="confirmation-title">{activeRequest.title}</h2>
          {activeRequest.message && <p id="confirmation-message">{activeRequest.message}</p>}
        </div>
        <div className="confirmation-actions">
          <button className="confirmation-button" type="button" onClick={onCancel} disabled={isExiting}>
            Cancel
          </button>
          <button className="confirmation-button is-danger" type="button" onClick={onConfirm} disabled={isExiting}>
            {activeRequest.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
