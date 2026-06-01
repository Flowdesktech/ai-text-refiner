import { useEffect, useState } from 'react'
import type { RefineStatus } from '../../shared/types'

const LABELS: Record<RefineStatus['stage'], string> = {
  capturing: 'Capturing text…',
  refining: 'Refining…',
  pasting: 'Pasting…',
  done: 'Done',
  error: 'Error'
}

export default function Overlay(): React.JSX.Element {
  const [status, setStatus] = useState<RefineStatus>({ stage: 'refining' })

  useEffect(() => window.refiner.onStatus(setStatus), [])

  const isError = status.stage === 'error'
  const isDone = status.stage === 'done'
  const spinning = !isError && !isDone

  return (
    <div className={`overlay-card ${isError ? 'is-error' : ''} ${isDone ? 'is-done' : ''}`}>
      <div className="overlay-icon">
        {spinning && <span className="spinner" />}
        {isDone && <span className="check">✓</span>}
        {isError && <span className="cross">!</span>}
      </div>
      <div className="overlay-text">
        <div className="overlay-title">{LABELS[status.stage]}</div>
        {isError && 'message' in status && <div className="overlay-detail">{status.message}</div>}
      </div>
    </div>
  )
}
