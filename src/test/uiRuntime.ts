import { abortableSleep, throwIfAborted } from "../core/providers/base.ts"
import { DemoProvider } from "../core/providers/demo.ts"
import { DEFAULT_DEMO_FAULT_PLAN, FaultInjectingProvider } from "../core/providers/faultInjecting.ts"
import { runEvaluation } from "../core/runner.ts"
import type { ModelProvider, ModelRequest, ModelResponse } from "../core/types.ts"
import type { Runtime } from "../app/runtime.ts"

// UI 테스트용 runtime: 실제 core runner와 DemoProvider를 쓰되 지연 / backoff를 줄인다.

export function testRuntime(options: { demoDelayMs?: number; provider?: () => ModelProvider } = {}): Runtime & {
  calls: Parameters<typeof runEvaluation>[]
} {
  const calls: Parameters<typeof runEvaluation>[] = []
  return {
    calls,
    runEvaluation: (input, deps, runOptions) => {
      calls.push([input, deps, runOptions])
      return runEvaluation(input, { ...deps, sleep: async (_ms, signal) => throwIfAborted(signal), random: () => 0 }, runOptions)
    },
    createProviders: ({ faultSimulation }) => {
      const demo = options.provider?.() ?? new DemoProvider({ delayMs: options.demoDelayMs ?? 0 })
      return { demo: faultSimulation ? new FaultInjectingProvider(demo, DEFAULT_DEMO_FAULT_PLAN) : demo }
    },
  }
}

/** 처음 fastCalls번은 즉시 Demo 응답, 이후 호출은 abort될 때까지 대기. 받은 signal을 기록한다. */
export class GateProvider implements ModelProvider {
  readonly descriptor = new DemoProvider().descriptor
  readonly signals: AbortSignal[] = []
  private calls = 0
  private readonly demo = new DemoProvider({ delayMs: 0 })
  private readonly fastCalls: number

  constructor(fastCalls: number) {
    this.fastCalls = fastCalls
  }

  async run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    this.calls++
    this.signals.push(options.signal)
    if (this.calls <= this.fastCalls) return this.demo.run(request, options)
    await abortableSleep(1_000_000, options.signal)
    throw new Error("unreachable")
  }
}
