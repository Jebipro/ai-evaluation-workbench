import { fnv1a, ProviderError, throwIfAborted } from "./base.ts"
import type { ErrorKind, ModelProvider, ModelRequest, ModelResponse, ProviderDescriptor } from "../types.ts"

// ============================================================================
// FaultInjectingProvider — 인프라 오류 주입 래퍼
//
// 평가 결과 조작이 아니다. inner provider 호출 전에 transport 수준 오류(429, 5xx 등)를 던질 뿐,
// 성공한 응답의 output은 건드리지 않는다.
//
// 실패 여부는 (rendered prompt의 hash, 그 prompt에 대한 시도 순번)으로만 결정한다.
// 호출 순서 / concurrency / case ID / variant ID에 의존하지 않으므로 deterministic하다.
// (주의: 완전히 동일한 prompt를 가진 task가 둘 이상이면 시도 순번 counter를 공유한다.)
// ============================================================================

/** attempt는 1부터 시작. 오류를 주입하려면 ErrorKind, 아니면 undefined */
export type FaultPlan = (promptHash: number, attempt: number) => ErrorKind | undefined

export function promptKey(request: Pick<ModelRequest, "systemPrompt" | "prompt">): string {
  return `${request.systemPrompt ?? ""}\u0000${request.prompt}`
}

export function promptHash(request: Pick<ModelRequest, "systemPrompt" | "prompt">): number {
  return fnv1a(promptKey(request))
}

/**
 * Demo UI의 "인프라 오류 시뮬레이션" 기본 plan.
 * - hash % 7 === 0 → 항상 http_5xx (retry 소진 → ERROR)
 * - hash % 5 === 1 → 첫 시도만 http_429 (retry 후 성공)
 */
export const DEFAULT_DEMO_FAULT_PLAN: FaultPlan = (hash, attempt) => {
  if (hash % 7 === 0) return "http_5xx"
  if (hash % 5 === 1 && attempt === 1) return "http_429"
  return undefined
}

const FAULT_HTTP_STATUS: Partial<Record<ErrorKind, number>> = {
  http_429: 429,
  http_5xx: 503,
  http_4xx: 400,
}

export class FaultInjectingProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor
  private readonly inner: ModelProvider
  private readonly plan: FaultPlan
  private readonly attemptsByPrompt = new Map<string, number>()

  constructor(inner: ModelProvider, plan: FaultPlan) {
    this.inner = inner
    this.plan = plan
    this.descriptor = inner.descriptor
  }

  async run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    throwIfAborted(options.signal)
    const key = promptKey(request)
    const attempt = (this.attemptsByPrompt.get(key) ?? 0) + 1
    this.attemptsByPrompt.set(key, attempt)
    const kind = this.plan(fnv1a(key), attempt)
    if (kind !== undefined) {
      throw new ProviderError(kind, `[시뮬레이션된 인프라 오류] ${kind} (attempt ${attempt})`, {
        httpStatus: FAULT_HTTP_STATUS[kind],
      })
    }
    return this.inner.run(request, options)
  }
}
