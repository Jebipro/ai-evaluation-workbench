// Evaluation core의 공용 타입. React / 브라우저 API에 의존하지 않는다.

// ---------------------------------------------------------------------------
// Test case / evaluator
// ---------------------------------------------------------------------------

export type NormalizationOptions = {
  trim: boolean
  caseSensitive: boolean
  collapseWhitespace: boolean
}

export type JsonPrimitive = string | number | boolean | null

export type JsonValueType = "string" | "number" | "boolean" | "object" | "array" | "null"

export type JsonFieldRule = {
  /** dot path. 예: "user.name", "items.0.id" */
  path: string
  /** 기본 true. false이고 값이 없으면 rule 통과 */
  required?: boolean
  type?: JsonValueType
  equals?: JsonPrimitive
  oneOf?: JsonPrimitive[]
}

/**
 * normalization은 생략하면 DEFAULT_NORMALIZATION(trim만 적용)이 쓰인다.
 * 명시된 옵션 외의 암묵적 처리(lowercase, 공백 제거)는 하지 않는다.
 */
export type EvaluatorConfig =
  | { type: "exact-match"; expected: string; threshold?: number; normalization?: Partial<NormalizationOptions> }
  | { type: "contains"; expected: string; threshold?: number; normalization?: Partial<NormalizationOptions> }
  | { type: "regex"; pattern: string; flags?: string; threshold?: number }
  | { type: "json-valid"; threshold?: number }
  | { type: "json-fields"; rules: JsonFieldRule[]; threshold?: number }

export type EvaluatorType = EvaluatorConfig["type"]

export type TestCase = {
  id: string
  name: string
  input: string
  evaluator: EvaluatorConfig
  tags?: string[]
}

export type Dataset = {
  id: string
  name: string
  description?: string
  cases: TestCase[]
}

// ---------------------------------------------------------------------------
// Prompt variant
// ---------------------------------------------------------------------------

export type ModelConfig = {
  /** provider registry key. 예: "demo", "ollama" */
  provider: string
  model: string
  temperature?: number
  seed?: number
}

export type PromptVariant = {
  id: string
  name: string
  systemPrompt?: string
  promptTemplate: string
  modelConfig: ModelConfig
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type ErrorKind =
  | "timeout"
  | "cancelled"
  | "network"
  | "http_429"
  | "http_5xx"
  | "http_4xx"
  | "invalid_response"
  | "unknown"

export type ProviderDescriptor = {
  id: string
  kind: "demo" | "ollama"
  /** demo는 true. simulated provider는 latency / usage를 기록하지 않는다. */
  simulated: boolean
  model?: string
  /** secret 금지 */
  baseUrl?: string
}

export type TokenUsage = { inputTokens?: number; outputTokens?: number }

export type ModelRequest = {
  model: string
  systemPrompt?: string
  /** template에 input을 치환한 최종 user prompt */
  prompt: string
  temperature?: number
  seed?: number
  /**
   * 원본 test case input. 실제 provider는 사용하지 않는다(서버로 보내지 않음).
   * 규칙 기반 DemoProvider가 지시문과 입력을 구분하는 데에만 사용한다.
   */
  input: string
}

export type ModelResponse = {
  output: string
  usage?: TokenUsage
  /** detail panel의 metadata용. 서버 보고 duration 등은 여기에만 둔다. */
  raw?: unknown
}

export interface ModelProvider {
  readonly descriptor: ProviderDescriptor
  run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse>
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type RunStatus =
  | "idle"
  | "validating"
  | "running"
  | "completed"
  | "partiallyFailed"
  | "failed"
  | "cancelled"

export type TerminalRunStatus = Extract<RunStatus, "completed" | "partiallyFailed" | "failed" | "cancelled">

export type RunConfig = {
  concurrency: number
  defaultTimeoutMs: number
  maxRetries: number
}

export type CaseError = {
  kind: ErrorKind
  message: string
  /** 최초 시도를 포함한 총 시도 횟수 */
  attempts: number
  httpStatus?: number
}

export type CaseResult = {
  testCaseId: string
  variantId: string
  /** 실제 provider에 보낸 최종 prompt. 재현성의 핵심이므로 반드시 저장한다. */
  renderedPrompt: string
  output?: string
  score: number
  passed: boolean
  reason: string
  /** 성공한 마지막 attempt의 Runner 측정값. simulated provider / ERROR는 undefined */
  latencyMs?: number
  usage?: TokenUsage
  /** 성공 시 최종 시도 횟수 (retry 후 성공 여부 확인용) */
  attempts: number
  raw?: unknown
  error?: CaseError
}

export type CaseOutcome = "pass" | "fail" | "error"

export type UsageStat = { total: number; average: number; count: number }

export type VariantSummary = {
  variantId: string
  variantName: string
  plannedCount: number
  /** 완료된 case 수 (= completedCount). ERROR 포함 */
  n: number
  passCount: number
  /** passCount / n. n = 0이면 undefined */
  passRate?: number
  /** ERROR는 0점으로 포함 */
  averageScore?: number
  evalFailCount: number
  errorCount: number
  /** 값이 있는 성공 실행만. 없으면 undefined */
  averageLatencyMs?: number
  latencySampleCount: number
  usage: { inputTokens?: UsageStat; outputTokens?: UsageStat; coverage: number }
}

export type RunSummary = {
  plannedCount: number
  completedCount: number
  passCount: number
  evalFailCount: number
  errorCount: number
  variants: VariantSummary[]
}

export type EvaluationRun = {
  id: string
  createdAt: string
  finishedAt?: string
  status: RunStatus
  datasetSnapshot: { id: string; name: string; cases: TestCase[] }
  variantSnapshots: PromptVariant[]
  providerSnapshot: ProviderDescriptor[]
  config: RunConfig
  /** dataset cases × variants */
  plannedCount: number
  caseResults: CaseResult[]
  summary: RunSummary
  /** status가 failed일 때의 원인 */
  failureMessage?: string
}
