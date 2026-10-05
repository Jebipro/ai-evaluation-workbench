import { describe, expect, it } from "vitest"
import { DemoProvider } from "./demo.ts"
import { DEFAULT_DEMO_FAULT_PLAN, FaultInjectingProvider, promptHash, type FaultPlan } from "./faultInjecting.ts"
import type { ErrorKind, ModelRequest } from "../types.ts"

const prompts = Array.from({ length: 12 }, (_, i) => `prompt-${i} {{input}}`.replace("{{input}}", `input-${i}`))
const toRequest = (prompt: string): ModelRequest => ({ model: "demo", prompt, input: prompt.split(" ")[1] })

// 명시적 predicate: hash 짝수 → 항상 5xx, 홀수 → 첫 시도만 429
const plan: FaultPlan = (hash, attempt) => (hash % 2 === 0 ? "http_5xx" : attempt === 1 ? "http_429" : undefined)

async function attemptOutcome(provider: FaultInjectingProvider, request: ModelRequest): Promise<ErrorKind | "ok"> {
  try {
    await provider.run(request, { signal: new AbortController().signal })
    return "ok"
  } catch (error) {
    return (error as { kind: ErrorKind }).kind
  }
}

/** 각 prompt에 대해 3번 시도한 결과를 (호출 순서를 섞어) 수집한다 */
async function collect(order: number[], concurrent: boolean): Promise<Record<string, (ErrorKind | "ok")[]>> {
  const provider = new FaultInjectingProvider(new DemoProvider({ delayMs: 0 }), plan)
  const outcomes: Record<string, (ErrorKind | "ok")[]> = {}
  for (let round = 0; round < 3; round++) {
    const run = async (i: number) => {
      const kind = await attemptOutcome(provider, toRequest(prompts[i]))
      ;(outcomes[prompts[i]] ??= []).push(kind)
    }
    if (concurrent) await Promise.all(order.map(run))
    else for (const i of order) await run(i)
  }
  return outcomes
}

describe("FaultInjectingProvider", () => {
  it("rendered prompt hash와 시도 순번으로만 결정된다 (호출 순서 / concurrency와 무관)", async () => {
    const forward = prompts.map((_, i) => i)
    const sequential = await collect(forward, false)
    const shuffledConcurrent = await collect([...forward].reverse(), true)
    expect(shuffledConcurrent).toEqual(sequential)

    for (const prompt of prompts) {
      const expected = promptHash({ prompt }) % 2 === 0 ? ["http_5xx", "http_5xx", "http_5xx"] : ["http_429", "ok", "ok"]
      expect(sequential[prompt]).toEqual(expected)
    }
  })

  it("오류에 시뮬레이션 표시와 httpStatus를 남긴다", async () => {
    const provider = new FaultInjectingProvider(new DemoProvider({ delayMs: 0 }), () => "http_429")
    await expect(provider.run(toRequest(prompts[0]), { signal: new AbortController().signal })).rejects.toMatchObject({
      kind: "http_429",
      httpStatus: 429,
      message: expect.stringContaining("시뮬레이션된 인프라 오류"),
    })
  })

  it("오류를 주입하지 않으면 inner output을 그대로 돌려준다 (평가 결과 조작 아님)", async () => {
    const inner = new DemoProvider({ delayMs: 0 })
    const provider = new FaultInjectingProvider(inner, () => undefined)
    const request: ModelRequest = { model: "demo", prompt: "positive, negative, neutral 하나만 출력: 좋아요", input: "좋아요" }
    const signal = new AbortController().signal
    expect(await provider.run(request, { signal })).toEqual(await inner.run(request, { signal }))
  })

  it("기본 Demo plan: hash % 7 === 0 → 항상 5xx, hash % 5 === 1 → 첫 시도만 429", () => {
    expect(DEFAULT_DEMO_FAULT_PLAN(14, 1)).toBe("http_5xx")
    expect(DEFAULT_DEMO_FAULT_PLAN(14, 3)).toBe("http_5xx")
    expect(DEFAULT_DEMO_FAULT_PLAN(6, 1)).toBe("http_429")
    expect(DEFAULT_DEMO_FAULT_PLAN(6, 2)).toBeUndefined()
    expect(DEFAULT_DEMO_FAULT_PLAN(2, 1)).toBeUndefined()
  })
})
