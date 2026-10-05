import { describe, expect, it } from "vitest"
import { classificationPreset, jsonPreset, PRESETS } from "./presets.ts"
import { DemoProvider } from "./providers/demo.ts"
import { DEFAULT_DEMO_FAULT_PLAN, FaultInjectingProvider } from "./providers/faultInjecting.ts"
import { runEvaluation } from "./runner.ts"
import { compareVariants } from "./summary.ts"
import { validateDataset } from "./validation.ts"
import type { ModelProvider } from "./types.ts"

const instantSleep = async () => {}

async function runPreset(preset: (typeof PRESETS)[number], provider: ModelProvider = new DemoProvider({ delayMs: 0 })) {
  return runEvaluation(
    { dataset: preset.dataset, variants: [preset.variantA, preset.variantB] },
    { providers: { demo: provider }, sleep: instantSleep, random: () => 0 },
  )
}

describe("presets", () => {
  it("각 preset은 10개 내외의 유효한 case를 가진다", () => {
    for (const preset of PRESETS) {
      expect(preset.dataset.cases.length).toBeGreaterThanOrEqual(8)
      expect(validateDataset(preset.dataset)).toEqual([])
    }
  })

  it("Classification: 모호한 A 5/10, 명확한 B 9/10. 둘 다 PASS / B만 PASS / 둘 다 FAIL이 섞인다", async () => {
    const run = await runPreset(classificationPreset)
    const [a, b] = run.summary.variants
    expect(run.status).toBe("completed")
    expect([a.passCount, a.n]).toEqual([5, 10])
    expect([b.passCount, b.n]).toEqual([9, 10])
    const comparison = compareVariants(
      run.datasetSnapshot.cases.map((c) => c.id),
      run.caseResults,
      "variant-a",
      "variant-b",
    )
    expect(comparison.counts).toMatchObject({ "both-pass": 5, "b-only": 4, "both-not-pass": 1 })
  })

  it("Structured JSON: fence를 내는 A 0/10, JSON only B는 한글 나이 case만 partial fail", async () => {
    const run = await runPreset(jsonPreset)
    const [a, b] = run.summary.variants
    expect(a.passCount).toBe(0)
    expect(b.passCount).toBe(9)
    const aFirst = run.caseResults.find((r) => r.variantId === "variant-a")
    expect(aFirst?.reason).toContain("markdown code fence")
    const hard = run.caseResults.find((r) => r.testCaseId === "json-07" && r.variantId === "variant-b")
    expect(hard?.score).toBe(0.75)
    expect(hard?.reason).toContain("age: 기대 type number, 실제 null")
  })

  it("Prompt를 수정하면 Demo 결과가 달라진다", async () => {
    const edited = {
      ...jsonPreset,
      variantA: { ...jsonPreset.variantA, promptTemplate: `JSON만 출력하세요. ${jsonPreset.variantA.promptTemplate}` },
    }
    const run = await runPreset(edited)
    expect(run.summary.variants[0].passCount).toBeGreaterThan(0)
  })

  it("기본 인프라 오류 시뮬레이션은 preset에서 ERROR와 retry 성공을 모두 만든다 → partiallyFailed", async () => {
    for (const preset of PRESETS) {
      const provider = new FaultInjectingProvider(new DemoProvider({ delayMs: 0 }), DEFAULT_DEMO_FAULT_PLAN)
      const run = await runPreset(preset, provider)
      expect(run.status).toBe("partiallyFailed")
      expect(run.summary.errorCount).toBeGreaterThan(0)
      expect(run.caseResults.some((r) => !r.error && r.attempts > 1)).toBe(true)
    }
  })
})
