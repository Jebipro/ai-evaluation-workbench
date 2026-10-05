import { abortableSleep, ProviderError, throwIfAborted } from "../core/providers/base.ts"
import type { ErrorKind, ModelProvider, ModelRequest, ModelResponse, ProviderDescriptor } from "../core/types.ts"

// 테스트용 provider. 각 호출의 동작을 script 함수로 정하고 동시 실행 수와 signal을 기록한다.

export type ScriptStep =
  | { type: "ok"; output: string; delayMs?: number; usage?: ModelResponse["usage"] }
  | { type: "error"; kind: ErrorKind; delayMs?: number; httpStatus?: number }
  /** signal이 abort될 때까지 대기 */
  | { type: "hang" }
  /** signal을 무시하고 대기 (runner가 race로 끊어야 함) */
  | { type: "ignore-signal"; delayMs: number }

export type Script = (request: ModelRequest, attempt: number) => ScriptStep

export class ScriptedProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor
  readonly signals: AbortSignal[] = []
  readonly calls: ModelRequest[] = []
  inFlight = 0
  maxInFlight = 0
  private readonly attempts = new Map<string, number>()
  private readonly script: Script

  constructor(script: Script, descriptor: Partial<ProviderDescriptor> = {}) {
    this.script = script
    this.descriptor = { id: "scripted", kind: "ollama", simulated: false, ...descriptor }
  }

  async run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    const attempt = (this.attempts.get(request.prompt) ?? 0) + 1
    this.attempts.set(request.prompt, attempt)
    this.calls.push(request)
    this.signals.push(options.signal)
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      throwIfAborted(options.signal)
      const step = this.script(request, attempt)
      switch (step.type) {
        case "ok":
          if (step.delayMs) await abortableSleep(step.delayMs, options.signal)
          return { output: step.output, usage: step.usage }
        case "error":
          if (step.delayMs) await abortableSleep(step.delayMs, options.signal)
          throw new ProviderError(step.kind, `scripted ${step.kind}`, { httpStatus: step.httpStatus })
        case "hang":
          await abortableSleep(1_000_000, options.signal)
          throw new Error("unreachable")
        case "ignore-signal":
          await new Promise((resolve) => setTimeout(resolve, step.delayMs))
          return { output: "late" }
      }
    } finally {
      this.inFlight--
    }
  }
}

/** 즉시 resolve하는 sleep (backoff 대기 시간을 기록) */
export function recordingSleep(record: number[]) {
  return async (ms: number, signal: AbortSignal) => {
    record.push(ms)
    throwIfAborted(signal)
  }
}
