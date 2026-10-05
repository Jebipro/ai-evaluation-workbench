import { transition } from "../../core/status.ts"
import type { RunProgress } from "../../core/runner.ts"
import type { ValidationIssue } from "../../core/validation.ts"
import type { CaseResult, Dataset, EvaluationRun, PromptVariant, RunStatus } from "../../core/types.ts"

// Run state: 실행 중인 run의 진행 상황과 마지막으로 끝난 run.
// evaluation 의미론(status 판정, summary)은 core가 담당하고 여기서는 받아서 보관만 한다.

export type ActiveRunView = {
  dataset: Dataset
  variants: PromptVariant[]
}

export type RunState = {
  status: RunStatus
  plannedCount: number
  completedCount: number
  /** 실행 중 도착한 결과 (완료 순서) */
  liveResults: CaseResult[]
  /** 실행 중인 run의 입력 (live table 렌더링용) */
  active?: ActiveRunView
  /** 가장 최근에 끝난 run (cancelled / partiallyFailed / failed 포함) */
  run?: EvaluationRun
  validationIssues: ValidationIssue[]
  /** runner 자체가 예외를 던진 경우 (정상 흐름에서는 run.failureMessage를 쓴다) */
  crashMessage?: string
}

export type RunAction =
  | { type: "start"; active: ActiveRunView }
  | { type: "progress"; progress: RunProgress }
  | { type: "validationFailed"; issues: ValidationIssue[] }
  | { type: "finished"; run: EvaluationRun }
  | { type: "crashed"; message: string }
  | { type: "showRun"; run: EvaluationRun }

export const initialRunState: RunState = {
  status: "idle",
  plannedCount: 0,
  completedCount: 0,
  liveResults: [],
  validationIssues: [],
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return {
        ...state,
        status: transition(state.status, { type: "start" }),
        plannedCount: 0,
        completedCount: 0,
        liveResults: [],
        active: action.active,
        validationIssues: [],
        crashMessage: undefined,
      }
    case "progress": {
      const { progress } = action
      return {
        ...state,
        status: progress.status,
        plannedCount: progress.plannedCount,
        completedCount: progress.completedCount,
        liveResults: progress.latest ? [...state.liveResults, progress.latest] : state.liveResults,
      }
    }
    case "validationFailed":
      return { ...state, status: "idle", active: undefined, validationIssues: action.issues }
    case "finished":
      return {
        ...state,
        status: action.run.status,
        plannedCount: action.run.plannedCount,
        completedCount: action.run.caseResults.length,
        liveResults: [],
        active: undefined,
        run: action.run,
      }
    case "crashed":
      return { ...state, status: "failed", active: undefined, liveResults: [], crashMessage: action.message }
    case "showRun":
      if (state.status === "validating" || state.status === "running") return state
      return { ...state, status: action.run.status, run: action.run, validationIssues: [], crashMessage: undefined }
  }
}
