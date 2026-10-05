import type { RunState } from "../state/runState.ts"

type Props = {
  state: RunState
  isActive: boolean
  onRun: () => void
  onCancel: () => void
}

export function RunControls({ state, isActive, onRun, onCancel }: Props) {
  const { plannedCount, completedCount, status } = state
  const percent = plannedCount === 0 ? 0 : Math.round((completedCount / plannedCount) * 100)
  return (
    <div className="run-controls">
      <button type="button" className="button-primary" onClick={onRun} disabled={isActive}>
        {isActive ? "실행 중…" : "Run Evaluation"}
      </button>
      <button type="button" className="button-secondary" onClick={onCancel} disabled={!isActive}>
        Cancel
      </button>
      {isActive && (
        <div className="progress" aria-live="polite">
          <div
            className="progress-track"
            role="progressbar"
            aria-label="evaluation 진행률"
            aria-valuemin={0}
            aria-valuemax={plannedCount}
            aria-valuenow={completedCount}
          >
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="progress-text">
            {status === "validating" ? "검증 중…" : `${completedCount} / ${plannedCount} 완료`}
          </span>
        </div>
      )}
    </div>
  )
}
