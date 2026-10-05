import { describe, expect, it } from "vitest"
import { compareVariants, formatPassRate, summarizeRun } from "./summary.ts"
import type { CaseResult } from "./types.ts"

function result(testCaseId: string, variantId: string, patch: Partial<CaseResult>): CaseResult {
  return { testCaseId, variantId, renderedPrompt: "p", score: 0, passed: false, reason: "", attempts: 1, ...patch }
}

const variants = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
]

const results: CaseResult[] = [
  result("c1", "a", { output: "x", score: 1, passed: true, latencyMs: 100, usage: { inputTokens: 10, outputTokens: 2 } }),
  result("c1", "b", { output: "x", score: 1, passed: true, latencyMs: 300 }),
  result("c2", "a", { output: "y", score: 0.5, passed: false, latencyMs: 200, usage: { inputTokens: 20 } }),
  result("c2", "b", { output: "y", score: 1, passed: true, latencyMs: 100 }),
  result("c3", "a", { score: 0, passed: false, latencyMs: 9999, error: { kind: "timeout", message: "t", attempts: 3 } }),
  result("c3", "b", { output: "z", score: 0, passed: false }),
]

describe("summarizeRun", () => {
  const summary = summarizeRun(variants, 4, results)
  const [a, b] = summary.variants

  it("evaluator fail과 execution error를 분리해서 센다", () => {
    expect(a).toMatchObject({ passCount: 1, evalFailCount: 1, errorCount: 1 })
    expect(b).toMatchObject({ passCount: 2, evalFailCount: 1, errorCount: 0 })
    expect(summary).toMatchObject({ passCount: 3, evalFailCount: 2, errorCount: 1 })
  })

  it("ERROR case는 n과 pass rate 분모에 포함, score 0으로 평균에 포함", () => {
    expect(a.n).toBe(3)
    expect(a.passRate).toBeCloseTo(1 / 3)
    expect(a.averageScore).toBeCloseTo((1 + 0.5 + 0) / 3)
  })

  it("ERROR case는 average latency에서 제외", () => {
    expect(a.averageLatencyMs).toBe(150)
    expect(a.latencySampleCount).toBe(2)
    // latency 값이 없는 성공 실행도 평균에서 빠진다
    expect(b.averageLatencyMs).toBe(200)
    expect(b.latencySampleCount).toBe(2)
  })

  it("plannedCount와 completedCount(n)를 모두 둔다", () => {
    expect(summary.plannedCount).toBe(8)
    expect(summary.completedCount).toBe(6)
    expect(a.plannedCount).toBe(4)
  })

  it("usage는 실제 값이 있는 case만 집계하고 coverage를 남긴다", () => {
    expect(a.usage.coverage).toBe(2)
    expect(a.usage.inputTokens).toEqual({ total: 30, average: 15, count: 2 })
    expect(a.usage.outputTokens).toEqual({ total: 2, average: 2, count: 1 })
    expect(b.usage).toEqual({ inputTokens: undefined, outputTokens: undefined, coverage: 0 })
  })

  it("값이 없으면 undefined (N/A)", () => {
    const empty = summarizeRun(variants, 2, [])
    expect(empty.variants[0]).toMatchObject({ n: 0, passRate: undefined, averageScore: undefined, averageLatencyMs: undefined })
  })
})

describe("compareVariants", () => {
  it("case별 분류와 차이 있는 case", () => {
    const extra = [
      ...results,
      result("c4", "a", { output: "w", score: 1, passed: true }),
      result("c4", "b", { output: "w", score: 0, passed: false }),
    ]
    const comparison = compareVariants(["c1", "c2", "c3", "c4", "c5"], extra, "a", "b")
    expect(comparison.rows.map((r) => r.category)).toEqual(["both-pass", "b-only", "has-error", "a-only", "incomplete"])
    expect(comparison.rows.map((r) => r.differs)).toEqual([false, true, true, true, false])
    expect(comparison.counts).toEqual({
      "both-pass": 1,
      "a-only": 1,
      "b-only": 1,
      "both-not-pass": 0,
      "has-error": 1,
      incomplete: 1,
    })
  })

  it("둘 다 FAIL이어도 score가 다르면 차이 있음", () => {
    const comparison = compareVariants(
      ["c"],
      [result("c", "a", { output: "", score: 0.25 }), result("c", "b", { output: "", score: 0.75 })],
      "a",
      "b",
    )
    expect(comparison.rows[0]).toMatchObject({ category: "both-not-pass", differs: true })
  })
})

describe("formatPassRate", () => {
  it("n을 함께 표시한다", () => {
    expect(formatPassRate({ passCount: 8, n: 10, passRate: 0.8 })).toBe("8 / 10 (80%)")
    expect(formatPassRate({ passCount: 0, n: 0, passRate: undefined })).toBe("0 / 0 (N/A)")
  })
})
