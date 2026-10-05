import type { ValidationIssue } from "../../core/validation.ts"
import type { RunState } from "../state/runState.ts"

/** run 종료 후 status 배너. partiallyFailed는 "점수가 낮음"이 아니라 "실행 오류"라는 점을 명확히 한다. */
export function StatusBanner({ state }: { state: RunState }) {
  if (state.crashMessage) {
    return (
      <div className="banner banner-failed" role="alert">
        <strong>
          <span aria-hidden="true">⛔</span> 실행 실패
        </strong>{" "}
        runner 오류: {state.crashMessage}
      </div>
    )
  }
  const run = state.run
  if (!run || state.status !== run.status) return null
  const { completedCount, plannedCount, errorCount } = run.summary
  switch (run.status) {
    case "completed":
      return (
        <div className="banner banner-completed" role="status">
          <strong>
            <span aria-hidden="true">✓</span> 정상 완료
          </strong>{" "}
          · {completedCount} / {plannedCount} 실행, 실행 오류 없음. 점수는 아래 Summary를 확인하세요.
        </div>
      )
    case "partiallyFailed":
      return (
        <div className="banner banner-partial" role="status">
          <strong>
            <span aria-hidden="true">⚠</span> 일부 실행 오류
          </strong>{" "}
          · 실행 오류 {errorCount}건. 해당 case는 output 없이 0점(ERROR)으로 집계되었습니다. 낮은 정답률(FAIL)과는 다른
          의미입니다.
        </div>
      )
    case "cancelled":
      return (
        <div className="banner banner-cancelled" role="status">
          <strong>
            <span aria-hidden="true">■</span> 취소됨
          </strong>{" "}
          · {completedCount} / {plannedCount} 완료. 완료된 결과는 보존되었습니다.
        </div>
      )
    case "failed":
      return (
        <div className="banner banner-failed" role="alert">
          <strong>
            <span aria-hidden="true">⛔</span> 실행 실패
          </strong>{" "}
          · {run.failureMessage ?? "원인을 알 수 없습니다."}
        </div>
      )
    default:
      return null
  }
}

export function ValidationErrors({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null
  return (
    <div className="banner banner-failed validation-errors" role="alert">
      <strong>실행 전 검증 실패 — run을 시작하지 않았습니다 ({issues.length}건)</strong>
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>
            <code>{issue.path}</code>: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
