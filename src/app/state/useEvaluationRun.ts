import { useCallback, useEffect, useReducer, useRef } from "react"
import { RunValidationError, type RunInput } from "../../core/runner.ts"
import { isActiveStatus } from "../../core/status.ts"
import type { EvaluationRun, ModelProvider } from "../../core/types.ts"
import type { Runtime } from "../runtime.ts"
import { initialRunState, runReducer } from "./runState.ts"

export type UseEvaluationRunOptions = {
  runtime: Runtime
  /** run이 끝났을 때 (cancelled / partiallyFailed / failed 포함). validation 실패 시에는 호출되지 않는다. */
  onFinished?: (run: EvaluationRun) => void
}

/**
 * core runner를 React에 연결하는 feature hook.
 * - 동시에 두 run을 시작하지 않는다 (ref로 동기 확인 → 연속 클릭에도 안전)
 * - cancel은 AbortController.abort() → runner → provider fetch까지 전달된다
 */
export function useEvaluationRun({ runtime, onFinished }: UseEvaluationRunOptions) {
  const [state, dispatch] = useReducer(runReducer, initialRunState)
  const controllerRef = useRef<AbortController | null>(null)
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback(
    async (input: RunInput, providers: Record<string, ModelProvider>) => {
      if (controllerRef.current !== null) return
      const controller = new AbortController()
      controllerRef.current = controller
      dispatch({ type: "start", active: { dataset: input.dataset, variants: input.variants } })
      try {
        const run = await runtime.runEvaluation(input, { providers }, {
          signal: controller.signal,
          onProgress: (progress) => dispatch({ type: "progress", progress }),
        })
        dispatch({ type: "finished", run })
        onFinishedRef.current?.(run)
      } catch (error) {
        if (error instanceof RunValidationError) dispatch({ type: "validationFailed", issues: error.issues })
        else dispatch({ type: "crashed", message: error instanceof Error ? error.message : String(error) })
      } finally {
        controllerRef.current = null
      }
    },
    [runtime],
  )

  const cancel = useCallback(() => controllerRef.current?.abort(), [])
  const showRun = useCallback((run: EvaluationRun) => dispatch({ type: "showRun", run }), [])

  return { state, start, cancel, showRun, isActive: isActiveStatus(state.status) }
}
