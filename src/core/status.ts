import type { CaseOutcome, CaseResult, RunStatus, TerminalRunStatus } from "./types.ts"

// Run status 전이와 최종 status 판정. 순수 함수.
//
//   idle → validating → idle                (validation 실패: run 저장 안 함)
//   idle → validating → running → completed | partiallyFailed | failed | cancelled
//   terminal → (새 run 시작) validating

export const TERMINAL_STATUSES: readonly TerminalRunStatus[] = ["completed", "partiallyFailed", "failed", "cancelled"]

export function isTerminalStatus(status: RunStatus): status is TerminalRunStatus {
  return (TERMINAL_STATUSES as readonly RunStatus[]).includes(status)
}

/** 동시에 두 개의 run이 활성화될 수 없다. */
export function isActiveStatus(status: RunStatus): boolean {
  return status === "validating" || status === "running"
}

export type RunEvent =
  | { type: "start" }
  | { type: "validationFailed" }
  | { type: "validationPassed" }
  | { type: "finish"; status: TerminalRunStatus }

export class InvalidTransitionError extends Error {
  constructor(from: RunStatus, event: RunEvent) {
    super(`잘못된 run status 전이: ${from} --${event.type}-->`)
    this.name = "InvalidTransitionError"
  }
}

export function transition(from: RunStatus, event: RunEvent): RunStatus {
  switch (event.type) {
    case "start":
      if (from === "idle" || isTerminalStatus(from)) return "validating"
      break
    case "validationFailed":
      if (from === "validating") return "idle"
      break
    case "validationPassed":
      if (from === "validating") return "running"
      break
    case "finish":
      if (from === "running") return event.status
      break
  }
  throw new InvalidTransitionError(from, event)
}

/** error가 있으면 error, 아니면 passed 기준. 결과 상태를 별도 필드로 저장하지 않는다. */
export function getCaseOutcome(result: Pick<CaseResult, "error" | "passed">): CaseOutcome {
  if (result.error) return "error"
  return result.passed ? "pass" : "fail"
}

/**
 * - cancelled: 사용자가 취소
 * - failed: runner 수준의 치명적 오류, 또는 모든 실행이 error
 * - partiallyFailed: execution error 1건 이상 + 성공 실행 1건 이상 (점수와 무관)
 * - completed: execution error 없이 모든 planned case 종료 (점수가 낮아도 completed)
 */
export function deriveFinalStatus(params: {
  cancelled: boolean
  fatalError: boolean
  results: readonly Pick<CaseResult, "error">[]
}): TerminalRunStatus {
  if (params.cancelled) return "cancelled"
  if (params.fatalError) return "failed"
  const errorCount = params.results.filter((r) => r.error).length
  const successCount = params.results.length - errorCount
  if (params.results.length === 0 || successCount === 0) return "failed"
  if (errorCount > 0) return "partiallyFailed"
  return "completed"
}
