import { describe, expect, it } from "vitest"
import { backoffDelayMs, runEvaluation, RunValidationError, type RunnerDeps, type RunProgress } from "./runner.ts"
import { abortableSleep } from "./providers/base.ts"
import { recordingSleep, ScriptedProvider, type Script } from "../test/scriptedProvider.ts"
import type { Dataset, PromptVariant } from "./types.ts"

function makeDataset(count: number): Dataset {
  return {
    id: "ds",
    name: "dataset",
    cases: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      name: `case ${i}`,
      input: `input-${i}`,
      evaluator: { type: "exact-match" as const, expected: "ok" },
    })),
  }
}

function variant(id: string, template = `${id}: {{input}}`): PromptVariant {
  return { id, name: id.toUpperCase(), promptTemplate: template, modelConfig: { provider: "p", model: "m" } }
}

function deps(provider: ScriptedProvider, extra: Partial<RunnerDeps> = {}): RunnerDeps {
  const sleeps: number[] = []
  return { providers: { p: provider }, sleep: recordingSleep(sleeps), random: () => 0, ...extra }
}

const okScript: Script = () => ({ type: "ok", output: "ok" })

describe("runEvaluation: 기본 실행", () => {
  it("dataset × variants를 실행하고 rendered prompt를 저장한다", async () => {
    const provider = new ScriptedProvider(okScript)
    const run = await runEvaluation({ dataset: makeDataset(2), variants: [variant("a"), variant("b")] }, deps(provider))
    expect(run.status).toBe("completed")
    expect(run.plannedCount).toBe(4)
    expect(run.caseResults).toHaveLength(4)
    expect(run.caseResults[0]).toMatchObject({ testCaseId: "c0", variantId: "a", renderedPrompt: "a: input-0", passed: true })
    expect(run.caseResults[3].renderedPrompt).toBe("b: input-1")
    expect(run.summary.completedCount).toBe(4)
    expect(run.providerSnapshot).toEqual([{ id: "scripted", kind: "ollama", simulated: false, model: "m" }])
  })

  it("점수가 낮아도 execution error가 없으면 completed", async () => {
    const provider = new ScriptedProvider(() => ({ type: "ok", output: "wrong" }))
    const run = await runEvaluation({ dataset: makeDataset(3), variants: [variant("a")] }, deps(provider))
    expect(run.status).toBe("completed")
    expect(run.summary.variants[0]).toMatchObject({ passCount: 0, evalFailCount: 3, errorCount: 0 })
  })

  it("systemPrompt와 modelConfig를 provider request로 전달한다", async () => {
    const provider = new ScriptedProvider(okScript)
    const v = { ...variant("a"), systemPrompt: "sys", modelConfig: { provider: "p", model: "m", temperature: 0, seed: 7 } }
    await runEvaluation({ dataset: makeDataset(1), variants: [v] }, deps(provider))
    expect(provider.calls[0]).toEqual({ model: "m", systemPrompt: "sys", prompt: "a: input-0", temperature: 0, seed: 7, input: "input-0" })
  })
})

describe("validation", () => {
  it("validation 실패 시 run을 만들지 않고 validating → idle", async () => {
    const provider = new ScriptedProvider(okScript)
    const statuses: string[] = []
    const promise = runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a", "no placeholder")] },
      deps(provider),
      { onProgress: (p) => statuses.push(p.status) },
    )
    await expect(promise).rejects.toBeInstanceOf(RunValidationError)
    await promise.catch((error: RunValidationError) => {
      expect(error.issues[0].message).toContain("{{input}}")
    })
    expect(statuses).toEqual(["validating", "idle"])
    expect(provider.calls).toHaveLength(0)
  })

  it("등록되지 않은 provider는 validation error", async () => {
    const provider = new ScriptedProvider(okScript)
    const v = { ...variant("a"), modelConfig: { provider: "missing", model: "m" } }
    await expect(runEvaluation({ dataset: makeDataset(1), variants: [v] }, deps(provider))).rejects.toBeInstanceOf(
      RunValidationError,
    )
  })
})

describe("concurrency", () => {
  it("동시 실행 수가 concurrency를 넘지 않는다", async () => {
    const provider = new ScriptedProvider(() => ({ type: "ok", output: "ok", delayMs: 5 }))
    await runEvaluation({ dataset: makeDataset(10), variants: [variant("a")], config: { concurrency: 2 } }, deps(provider))
    expect(provider.maxInFlight).toBe(2)
  })

  it("기본 concurrency는 3", async () => {
    const provider = new ScriptedProvider(() => ({ type: "ok", output: "ok", delayMs: 5 }))
    const run = await runEvaluation({ dataset: makeDataset(10), variants: [variant("a")] }, deps(provider))
    expect(provider.maxInFlight).toBe(3)
    expect(run.config.concurrency).toBe(3)
  })
})

describe("partial failure / status", () => {
  it("한 case의 error가 run 전체를 죽이지 않는다 → partiallyFailed", async () => {
    const provider = new ScriptedProvider((req) =>
      req.input === "input-1" ? { type: "error", kind: "http_4xx", httpStatus: 400 } : { type: "ok", output: "ok" },
    )
    const run = await runEvaluation({ dataset: makeDataset(3), variants: [variant("a")] }, deps(provider))
    expect(run.status).toBe("partiallyFailed")
    expect(run.caseResults).toHaveLength(3)
    const errored = run.caseResults[1]
    expect(errored).toMatchObject({ score: 0, passed: false })
    expect(errored.output).toBeUndefined()
    expect(errored.error).toEqual({ kind: "http_4xx", message: "scripted http_4xx", attempts: 1, httpStatus: 400 })
    expect(run.summary.variants[0]).toMatchObject({ n: 3, passCount: 2, evalFailCount: 0, errorCount: 1 })
  })

  it("모든 실행이 error면 failed와 원인", async () => {
    const provider = new ScriptedProvider(() => ({ type: "error", kind: "http_4xx" }))
    const run = await runEvaluation({ dataset: makeDataset(2), variants: [variant("a")] }, deps(provider))
    expect(run.status).toBe("failed")
    expect(run.failureMessage).toContain("http_4xx 2건")
  })

  it("output이 문자열이 아니면 invalid_response (retry 안 함)", async () => {
    const provider = new ScriptedProvider(okScript)
    provider.run = async () => ({ output: undefined as unknown as string })
    const run = await runEvaluation({ dataset: makeDataset(1), variants: [variant("a")] }, deps(provider))
    expect(run.caseResults[0].error).toMatchObject({ kind: "invalid_response", attempts: 1 })
  })
})

describe("retry / backoff", () => {
  it("retryable error 후 성공하면 결과는 PASS, attempts 기록", async () => {
    const sleeps: number[] = []
    const provider = new ScriptedProvider((_req, attempt) =>
      attempt === 1 ? { type: "error", kind: "http_429" } : { type: "ok", output: "ok" },
    )
    const run = await runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a")] },
      deps(provider, { sleep: recordingSleep(sleeps), random: () => 0.5 }),
    )
    expect(run.status).toBe("completed")
    expect(run.caseResults[0]).toMatchObject({ passed: true, attempts: 2 })
    expect(run.caseResults[0].error).toBeUndefined()
    expect(sleeps).toEqual([350])
  })

  it("retry 소진 시 마지막 kind와 총 attempts(최초 + 2 retries = 3)", async () => {
    const sleeps: number[] = []
    const provider = new ScriptedProvider((_req, attempt) => ({
      type: "error",
      kind: attempt === 3 ? "timeout" : "http_5xx",
    }))
    const run = await runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a")] },
      deps(provider, { sleep: recordingSleep(sleeps) }),
    )
    expect(run.caseResults[0].error).toMatchObject({ kind: "timeout", attempts: 3 })
    expect(provider.calls).toHaveLength(3)
    expect(sleeps).toEqual([300, 600])
  })

  it("non-retryable error는 retry하지 않는다", async () => {
    for (const kind of ["http_4xx", "invalid_response", "unknown"] as const) {
      const sleeps: number[] = []
      const provider = new ScriptedProvider(() => ({ type: "error", kind }))
      const run = await runEvaluation(
        { dataset: makeDataset(1), variants: [variant("a")] },
        deps(provider, { sleep: recordingSleep(sleeps) }),
      )
      expect(run.caseResults[0].error).toMatchObject({ kind, attempts: 1 })
      expect(sleeps).toEqual([])
    }
  })

  it("backoff는 300ms × 2^n + jitter(≤100ms)", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(300)
    expect(backoffDelayMs(1, () => 0)).toBe(600)
    expect(backoffDelayMs(2, () => 0.999)).toBe(1299)
  })

  it("backoff 대기 중 abort되면 즉시 중단하고 cancelled", async () => {
    const controller = new AbortController()
    const realProvider = new ScriptedProvider(() => ({ type: "error", kind: "http_5xx" }))
    let sleepStarted!: () => void
    const sleeping = new Promise<void>((resolve) => (sleepStarted = resolve))
    const started = Date.now()
    const promise = runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a")] },
      {
        providers: { p: realProvider },
        random: () => 0,
        sleep: (_ms, signal) => {
          sleepStarted()
          return abortableSleep(60_000, signal)
        },
      },
      { signal: controller.signal },
    )
    await sleeping
    controller.abort()
    const run = await promise
    expect(Date.now() - started).toBeLessThan(2000)
    expect(run.status).toBe("cancelled")
    expect(run.caseResults).toEqual([])
    expect(realProvider.calls).toHaveLength(1)
  })
})

describe("timeout vs cancelled", () => {
  it("runner timeout은 timeout kind (retry 대상)", async () => {
    const provider = new ScriptedProvider(() => ({ type: "hang" }))
    const run = await runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a")], config: { defaultTimeoutMs: 10, maxRetries: 1 } },
      deps(provider),
    )
    expect(run.caseResults[0].error).toMatchObject({ kind: "timeout", attempts: 2 })
    expect(run.status).toBe("failed")
    // timeout 시 provider에 전달한 signal도 abort되어야 한다
    expect(provider.signals.every((s) => s.aborted)).toBe(true)
  })

  it("signal을 무시하는 provider도 runner timeout으로 끊는다", async () => {
    const provider = new ScriptedProvider(() => ({ type: "ignore-signal", delayMs: 300 }))
    const started = Date.now()
    const run = await runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a")], config: { defaultTimeoutMs: 10, maxRetries: 0 } },
      deps(provider),
    )
    expect(run.caseResults[0].error?.kind).toBe("timeout")
    expect(Date.now() - started).toBeLessThan(250)
  })

  it("사용자 cancel은 cancelled이며 timeout으로 보고되지 않는다", async () => {
    const controller = new AbortController()
    const provider = new ScriptedProvider(() => ({ type: "hang" }))
    const promise = runEvaluation(
      { dataset: makeDataset(1), variants: [variant("a")], config: { defaultTimeoutMs: 60_000 } },
      deps(provider),
      { signal: controller.signal },
    )
    await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    const run = await promise
    expect(run.status).toBe("cancelled")
    expect(run.caseResults).toEqual([])
  })
})

describe("cancel", () => {
  it("signal이 provider까지 전달되고, 완료된 결과는 보존된다", async () => {
    const controller = new AbortController()
    const provider = new ScriptedProvider((req) =>
      Number(req.input.split("-")[1]) < 2 ? { type: "ok", output: "ok" } : { type: "hang" },
    )
    const progress: RunProgress[] = []
    const promise = runEvaluation(
      { dataset: makeDataset(6), variants: [variant("a")], config: { concurrency: 2 } },
      deps(provider),
      {
        signal: controller.signal,
        onProgress: (p) => {
          progress.push(p)
          if (p.completedCount === 2 && p.status === "running") setTimeout(() => controller.abort(), 5)
        },
      },
    )
    const run = await promise
    expect(run.status).toBe("cancelled")
    expect(run.plannedCount).toBe(6)
    expect(run.summary.completedCount).toBe(2)
    expect(run.summary.plannedCount).toBe(6)
    expect(run.caseResults.map((r) => r.testCaseId)).toEqual(["c0", "c1"])
    // 실행 중이던 요청의 signal이 실제로 abort됨 (가짜 cancel이 아님)
    const hanging = provider.signals.slice(2)
    expect(hanging.length).toBeGreaterThan(0)
    expect(hanging.every((s) => s.aborted)).toBe(true)
    // 시작되지 않은 case는 provider를 호출하지 않는다
    expect(provider.calls.length).toBeLessThan(6)
    expect(run.summary.variants[0].n).toBe(2)
    expect(progress.at(-1)).toMatchObject({ status: "cancelled", completedCount: 2 })
  })

  it("이미 abort된 signal로 시작하면 아무것도 실행하지 않고 cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new ScriptedProvider(okScript)
    const run = await runEvaluation({ dataset: makeDataset(2), variants: [variant("a")] }, deps(provider), {
      signal: controller.signal,
    })
    expect(run.status).toBe("cancelled")
    expect(provider.calls).toHaveLength(0)
  })
})

describe("결과 순서 / snapshot / latency", () => {
  it("완료 순서와 무관하게 case 순서 → variant 순서로 정렬", async () => {
    // 뒤쪽 case가 먼저 끝나도록 지연을 역순으로 준다
    const provider = new ScriptedProvider((req) => {
      const index = Number(req.input.split("-")[1])
      return { type: "ok", output: "ok", delayMs: (5 - index) * 4 + (req.prompt.startsWith("b") ? 0 : 2) }
    })
    const run = await runEvaluation(
      { dataset: makeDataset(5), variants: [variant("a"), variant("b")], config: { concurrency: 4 } },
      deps(provider),
    )
    expect(run.caseResults.map((r) => `${r.testCaseId}/${r.variantId}`)).toEqual([
      "c0/a", "c0/b", "c1/a", "c1/b", "c2/a", "c2/b", "c3/a", "c3/b", "c4/a", "c4/b",
    ])
  })

  it("run snapshot은 이후 dataset / variant 수정의 영향을 받지 않는다", async () => {
    const dataset = makeDataset(2)
    const variants = [variant("a")]
    const provider = new ScriptedProvider(() => ({ type: "ok", output: "ok", delayMs: 5 }))
    const promise = runEvaluation({ dataset, variants }, deps(provider))
    // 실행 도중 수정
    dataset.cases[1].input = "mutated"
    variants[0].promptTemplate = "changed {{input}}"
    const run = await promise
    expect(run.caseResults[1].renderedPrompt).toBe("a: input-1")
    // 실행 후 수정
    dataset.cases[0].name = "renamed"
    ;(dataset.cases[0].evaluator as { expected: string }).expected = "other"
    expect(run.datasetSnapshot.cases[0].name).toBe("case 0")
    expect(run.datasetSnapshot.cases[0].evaluator).toEqual({ type: "exact-match", expected: "ok" })
    expect(run.variantSnapshots[0].promptTemplate).toBe("a: {{input}}")
  })

  it("latency는 성공한 마지막 attempt만 측정 (backoff 제외), simulated provider는 기록하지 않음", async () => {
    let clock = 0
    const now = () => (clock += 10)
    const provider = new ScriptedProvider((_req, attempt) =>
      attempt === 1 ? { type: "error", kind: "network" } : { type: "ok", output: "ok", usage: { inputTokens: 3 } },
    )
    const run = await runEvaluation({ dataset: makeDataset(1), variants: [variant("a")] }, deps(provider, { now }))
    expect(run.caseResults[0].latencyMs).toBe(10)
    expect(run.caseResults[0].usage).toEqual({ inputTokens: 3 })

    const simulated = new ScriptedProvider(() => ({ type: "ok", output: "ok", usage: { inputTokens: 3 } }), { simulated: true })
    const simRun = await runEvaluation({ dataset: makeDataset(1), variants: [variant("a")] }, deps(simulated, { now }))
    expect(simRun.caseResults[0].latencyMs).toBeUndefined()
    expect(simRun.caseResults[0].usage).toBeUndefined()
  })

  it("ERROR case: n 포함, latency 제외, score 0", async () => {
    let clock = 0
    const provider = new ScriptedProvider((req) =>
      req.input === "input-0" ? { type: "error", kind: "http_4xx" } : { type: "ok", output: "ok" },
    )
    const run = await runEvaluation(
      { dataset: makeDataset(2), variants: [variant("a")] },
      deps(provider, { now: () => (clock += 10) }),
    )
    const [summary] = run.summary.variants
    expect(summary.n).toBe(2)
    expect(summary.latencySampleCount).toBe(1)
    expect(run.caseResults[0].score).toBe(0)
    expect(run.caseResults[0].latencyMs).toBeUndefined()
    expect(summary.averageScore).toBe(0.5)
  })
})
