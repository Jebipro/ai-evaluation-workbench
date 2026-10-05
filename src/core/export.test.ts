import { describe, expect, it } from "vitest"
import { buildRunCsv, buildRunExport, CSV_COLUMNS, EXPORT_SCHEMA_VERSION } from "./export.ts"
import { classificationPreset } from "./presets.ts"
import { DemoProvider } from "./providers/demo.ts"
import { FaultInjectingProvider, promptHash } from "./providers/faultInjecting.ts"
import { runEvaluation } from "./runner.ts"
import { renderTemplate } from "./template.ts"

async function sampleRun() {
  // Prompt A × 첫 case의 rendered prompt만 항상 5xx → ERROR row 1개
  const { variantA, dataset } = classificationPreset
  const failingHash = promptHash({ prompt: renderTemplate(variantA.promptTemplate, dataset.cases[0].input) })
  const provider = new FaultInjectingProvider(new DemoProvider({ delayMs: 0 }), (hash) =>
    hash === failingHash ? "http_5xx" : undefined,
  )
  return runEvaluation(
    { dataset: classificationPreset.dataset, variants: [classificationPreset.variantA, classificationPreset.variantB] },
    { providers: { demo: provider }, sleep: async () => {}, random: () => 0, createId: () => "run-1", clock: () => new Date("2026-10-06T00:00:00Z") },
  )
}

describe("JSON export", () => {
  it("schemaVersion, run metadata, snapshot, rendered prompt, 정렬된 결과, summary를 포함한다", async () => {
    const run = await sampleRun()
    const exported = buildRunExport(run, new Date("2026-10-06T01:00:00Z"))

    expect(exported.schemaVersion).toBe(EXPORT_SCHEMA_VERSION)
    expect(exported.exportedAt).toBe("2026-10-06T01:00:00.000Z")
    expect(exported.run).toMatchObject({ id: "run-1", status: "partiallyFailed", plannedCount: 20, completedCount: 20 })
    expect(exported.dataset.cases).toHaveLength(10)
    expect(exported.variants.map((v) => v.id)).toEqual(["variant-a", "variant-b"])
    expect(exported.variants[1].systemPrompt).toBe(classificationPreset.variantB.systemPrompt)
    expect(exported.providers[0]).toMatchObject({ kind: "demo", simulated: true })
    expect(exported.results.map((r) => `${r.testCaseId}/${r.variantId}`).slice(0, 4)).toEqual([
      "sent-01/variant-a",
      "sent-01/variant-b",
      "sent-02/variant-a",
      "sent-02/variant-b",
    ])
    expect(exported.results[0]).toMatchObject({ outcome: "error", error: { kind: "http_5xx", attempts: 3, httpStatus: 503 } })
    expect(exported.results[1].renderedPrompt).toContain("Input:\n배송이 빨라서 정말 만족스러워요.")
    expect(exported.summary.errorCount).toBe(1)
    expect(exported.comparison?.counts["has-error"]).toBe(1)
    // JSON으로 직렬화 가능
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported)
  })

  it("export는 run과 독립된 복사본이다", async () => {
    const run = await sampleRun()
    const exported = buildRunExport(run)
    exported.results[0].reason = "changed"
    expect(run.caseResults[0].reason).not.toBe("changed")
  })
})

describe("CSV export", () => {
  it("CaseResult당 1행, PASS|FAIL|ERROR, escape 처리", async () => {
    const run = await sampleRun()
    const csv = buildRunCsv(run)
    const lines = csv.trimEnd().split("\r\n")
    expect(lines[0]).toBe(CSV_COLUMNS.join(","))
    expect(lines).toHaveLength(1 + run.caseResults.length)
    expect(lines[1]).toMatch(/^sent-01,빠른 배송 만족,variant-a,Prompt A,ERROR,0,false,/)
    expect(lines[1].endsWith(",3,http_5xx")).toBe(true)
    // reason에 쉼표와 따옴표가 있으므로 quote된다
    const failRow = lines.find((line) => line.includes(",FAIL,"))
    expect(failRow).toContain('"정규화 후 expected와 일치하지 않습니다. expected=""neutral"", actual=""mixed"""')
  })
})
