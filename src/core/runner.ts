import { evaluate, getThreshold, isPassed } from "./evaluators.ts"
import { abortableSleep, isRetryableKind, ProviderError, raceWithSignal } from "./providers/base.ts"
import { deriveFinalStatus, transition } from "./status.ts"
import { summarizeRun } from "./summary.ts"
import { renderTemplate } from "./template.ts"
import { validateRunInput, type ValidationIssue } from "./validation.ts"
import type {
  CaseError,
  CaseResult,
  Dataset,
  ErrorKind,
  EvaluationRun,
  ModelProvider,
  ProviderDescriptor,
  PromptVariant,
  RunConfig,
  RunStatus,
  TestCase,
} from "./types.ts"

// React와 독립된 evaluation runner.
// 작업 단위는 (case × variant). concurrency 제한, attempt별 timeout, cancel, bounded retry,
// partial failure, 결과 집계를 담당한다.

export const DEFAULT_RUN_CONFIG: RunConfig = {
  concurrency: 3,
  defaultTimeoutMs: 30_000,
  maxRetries: 2,
}

export const BACKOFF_BASE_MS = 300
export const BACKOFF_MAX_JITTER_MS = 100

export type RunInput = {
  dataset: Dataset
  variants: PromptVariant[]
  config?: Partial<RunConfig>
}

export type RunnerDeps = {
  /** modelConfig.provider → provider */
  providers: Record<string, ModelProvider>
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  random?: () => number
  now?: () => number
  clock?: () => Date
  createId?: () => string
}

export type RunProgress = {
  status: RunStatus
  plannedCount: number
  completedCount: number
  /** 방금 끝난 결과 (running 중에만) */
  latest?: CaseResult
}

export type RunOptions = {
  signal?: AbortSignal
  onProgress?: (progress: RunProgress) => void
}

export class RunValidationError extends Error {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[]) {
    super(`run validation 실패 (${issues.length}건)`)
    this.name = "RunValidationError"
    this.issues = issues
  }
}

export function backoffDelayMs(retryIndex: number, random: () => number): number {
  return BACKOFF_BASE_MS * 2 ** retryIndex + Math.floor(random() * BACKOFF_MAX_JITTER_MS)
}

type Task = { caseIndex: number; variantIndex: number; testCase: TestCase; variant: PromptVariant }

/** 실행 중이던 task가 사용자 취소로 끝났음을 나타내는 내부 신호. CaseResult를 만들지 않는다. */
class TaskCancelled extends Error {}

function defaultCreateId(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * Evaluation run을 실행한다.
 *
 * - validation 실패 시 RunValidationError를 throw한다 (run을 만들지 않음 → 저장되지 않음).
 * - 그 외에는 항상 EvaluationRun을 resolve한다 (cancelled / failed 포함).
 */
export async function runEvaluation(input: RunInput, deps: RunnerDeps, options: RunOptions = {}): Promise<EvaluationRun> {
  const signal = options.signal ?? new AbortController().signal
  const sleep = deps.sleep ?? abortableSleep
  const random = deps.random ?? Math.random
  const now = deps.now ?? (() => performance.now())
  const clock = deps.clock ?? (() => new Date())
  const createId = deps.createId ?? defaultCreateId

  let status: RunStatus = transition("idle", { type: "start" })
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, ...input.config }

  // 실행 시점 snapshot. 이후 dataset / prompt가 수정되어도 과거 run의 의미가 바뀌지 않도록 deep copy.
  const datasetSnapshot = structuredClone({ id: input.dataset.id, name: input.dataset.name, cases: input.dataset.cases })
  const variantSnapshots = structuredClone(input.variants)

  options.onProgress?.({ status, plannedCount: datasetSnapshot.cases.length * variantSnapshots.length, completedCount: 0 })

  const issues = validateRunInput({ dataset: datasetSnapshot, variants: variantSnapshots, config }, Object.keys(deps.providers))
  if (issues.length > 0) {
    status = transition(status, { type: "validationFailed" })
    options.onProgress?.({ status, plannedCount: 0, completedCount: 0 })
    throw new RunValidationError(issues)
  }
  status = transition(status, { type: "validationPassed" })

  const providerSnapshot = snapshotProviders(variantSnapshots, deps.providers)
  const tasks: Task[] = []
  datasetSnapshot.cases.forEach((testCase, caseIndex) => {
    variantSnapshots.forEach((variant, variantIndex) => tasks.push({ caseIndex, variantIndex, testCase, variant }))
  })
  const plannedCount = tasks.length
  const createdAt = clock().toISOString()
  const completed: { order: number; result: CaseResult }[] = []
  options.onProgress?.({ status, plannedCount, completedCount: 0 })

  let fatalError: unknown
  let nextTaskIndex = 0
  const worker = async () => {
    while (!signal.aborted && fatalError === undefined && nextTaskIndex < tasks.length) {
      const task = tasks[nextTaskIndex++]
      try {
        const result = await executeTask(task, config, deps.providers, signal, { sleep, random, now })
        completed.push({ order: task.caseIndex * variantSnapshots.length + task.variantIndex, result })
        options.onProgress?.({ status, plannedCount, completedCount: completed.length, latest: result })
      } catch (error) {
        if (error instanceof TaskCancelled) return
        fatalError = error
        return
      }
    }
  }
  const workerCount = Math.min(config.concurrency, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, worker))

  // 완료 순서와 무관하게 dataset case 순서 → variant 순서로 정렬
  const caseResults = completed.sort((a, b) => a.order - b.order).map((entry) => entry.result)
  const finalStatus = deriveFinalStatus({
    cancelled: signal.aborted && fatalError === undefined,
    fatalError: fatalError !== undefined,
    results: caseResults,
  })
  status = transition(status, { type: "finish", status: finalStatus })

  const run: EvaluationRun = {
    id: createId(),
    createdAt,
    finishedAt: clock().toISOString(),
    status,
    datasetSnapshot,
    variantSnapshots,
    providerSnapshot,
    config,
    plannedCount,
    caseResults,
    summary: summarizeRun(variantSnapshots, datasetSnapshot.cases.length, caseResults),
    failureMessage: describeFailure(finalStatus, fatalError, caseResults),
  }
  options.onProgress?.({ status, plannedCount, completedCount: caseResults.length })
  return run
}

function snapshotProviders(variants: PromptVariant[], providers: Record<string, ModelProvider>): ProviderDescriptor[] {
  const seen = new Map<string, ProviderDescriptor>()
  for (const variant of variants) {
    const key = `${variant.modelConfig.provider}\u0000${variant.modelConfig.model}`
    if (seen.has(key)) continue
    const descriptor = providers[variant.modelConfig.provider].descriptor
    seen.set(key, structuredClone({ ...descriptor, model: variant.modelConfig.model }))
  }
  return [...seen.values()]
}

function describeFailure(status: RunStatus, fatalError: unknown, results: CaseResult[]): string | undefined {
  if (status !== "failed") return undefined
  if (fatalError !== undefined) {
    return `runner 오류: ${fatalError instanceof Error ? fatalError.message : String(fatalError)}`
  }
  const kinds = new Map<ErrorKind, number>()
  for (const r of results) if (r.error) kinds.set(r.error.kind, (kinds.get(r.error.kind) ?? 0) + 1)
  const breakdown = [...kinds.entries()].map(([kind, count]) => `${kind} ${count}건`).join(", ")
  return `모든 실행이 실행 오류로 끝났습니다 (${breakdown}).`
}

type TaskUtils = {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  random: () => number
  now: () => number
}

async function executeTask(
  task: Task,
  config: RunConfig,
  providers: Record<string, ModelProvider>,
  runSignal: AbortSignal,
  utils: TaskUtils,
): Promise<CaseResult> {
  const { testCase, variant } = task
  const provider = providers[variant.modelConfig.provider]
  const renderedPrompt = renderTemplate(variant.promptTemplate, testCase.input)
  const request = {
    model: variant.modelConfig.model,
    systemPrompt: variant.systemPrompt,
    prompt: renderedPrompt,
    temperature: variant.modelConfig.temperature,
    seed: variant.modelConfig.seed,
    input: testCase.input,
  }
  const base = { testCaseId: testCase.id, variantId: variant.id, renderedPrompt }
  const maxAttempts = config.maxRetries + 1

  for (let attempt = 1; ; attempt++) {
    if (runSignal.aborted) throw new TaskCancelled()
    const outcome = await runAttempt(provider, request, config.defaultTimeoutMs, runSignal, utils.now)
    if (outcome.ok) {
      const { score, reason } = evaluate(testCase.evaluator, outcome.response.output)
      return {
        ...base,
        output: outcome.response.output,
        score,
        passed: isPassed(score, getThreshold(testCase.evaluator)),
        reason,
        // simulated provider는 latency / usage를 기록하지 않는다.
        latencyMs: provider.descriptor.simulated ? undefined : outcome.latencyMs,
        usage: provider.descriptor.simulated ? undefined : outcome.response.usage,
        attempts: attempt,
        raw: outcome.response.raw,
      }
    }
    const { error } = outcome
    if (error.kind === "cancelled") throw new TaskCancelled()
    if (!isRetryableKind(error.kind) || attempt >= maxAttempts) {
      const caseError: CaseError = { kind: error.kind, message: error.message, attempts: attempt }
      if (error.httpStatus !== undefined) caseError.httpStatus = error.httpStatus
      return {
        ...base,
        score: 0,
        passed: false,
        reason: `실행 오류 (${error.kind}): evaluator를 실행하지 않았습니다.`,
        attempts: attempt,
        error: caseError,
      }
    }
    try {
      // backoff 대기 중에도 abort되면 즉시 중단
      await utils.sleep(backoffDelayMs(attempt - 1, utils.random), runSignal)
    } catch {
      throw new TaskCancelled()
    }
  }
}

type AttemptOutcome =
  | { ok: true; response: { output: string; usage?: CaseResult["usage"]; raw?: unknown }; latencyMs: number }
  | { ok: false; error: { kind: ErrorKind; message: string; httpStatus?: number } }

/**
 * attempt 하나를 실행한다. timeout은 runner가 직접 관리하고, run signal과 timeout을 하나의
 * signal로 합쳐 provider에 전달한다. abort 원인을 추적해 timeout과 cancelled를 구분한다.
 */
async function runAttempt(
  provider: ModelProvider,
  request: Parameters<ModelProvider["run"]>[0],
  timeoutMs: number,
  runSignal: AbortSignal,
  now: () => number,
): Promise<AttemptOutcome> {
  const controller = new AbortController()
  let timedOut = false
  const onRunAbort = () => controller.abort()
  runSignal.addEventListener("abort", onRunAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const start = now()
  try {
    const response = await raceWithSignal(provider.run(request, { signal: controller.signal }), controller.signal)
    const latencyMs = now() - start
    if (typeof response?.output !== "string") {
      return { ok: false, error: { kind: "invalid_response", message: "provider 응답에 output 문자열이 없습니다." } }
    }
    return { ok: true, response, latencyMs }
  } catch (error) {
    if (runSignal.aborted) return { ok: false, error: { kind: "cancelled", message: "사용자가 취소했습니다." } }
    if (timedOut) return { ok: false, error: { kind: "timeout", message: `${timeoutMs}ms 안에 응답이 없습니다.` } }
    if (error instanceof ProviderError) {
      // run이 abort되지 않았는데 provider가 cancelled를 보고하면 원인 불명으로 본다.
      const kind = error.kind === "cancelled" ? "unknown" : error.kind
      return { ok: false, error: { kind, message: error.message, httpStatus: error.httpStatus } }
    }
    return { ok: false, error: { kind: "unknown", message: error instanceof Error ? error.message : String(error) } }
  } finally {
    clearTimeout(timer)
    runSignal.removeEventListener("abort", onRunAbort)
  }
}
