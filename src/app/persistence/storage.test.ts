import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { classificationPreset } from "../../core/presets.ts"
import { DemoProvider } from "../../core/providers/demo.ts"
import { runEvaluation } from "../../core/runner.ts"
import { createIdbStorage, MAX_STORED_RUNS } from "./storage.ts"

let dbCounter = 0
const freshStorage = () => createIdbStorage(`test-db-${++dbCounter}`)

async function makeRun(id: string, createdAt: string, signal?: AbortSignal) {
  return runEvaluation(
    { dataset: classificationPreset.dataset, variants: [classificationPreset.variantA, classificationPreset.variantB] },
    { providers: { demo: new DemoProvider({ delayMs: 0 }) }, createId: () => id, clock: () => new Date(createdAt) },
    { signal },
  )
}

describe("IndexedDB storage", () => {
  it("run을 snapshot째 저장하고 다시 읽는다", async () => {
    const storage = await freshStorage()
    const run = await makeRun("r1", "2026-10-06T00:00:00Z")
    await storage.saveRun(run)
    expect(await storage.getRun("r1")).toEqual(run)
  })

  it("cancelled run도 저장한다", async () => {
    const storage = await freshStorage()
    const controller = new AbortController()
    controller.abort()
    const run = await makeRun("cancelled", "2026-10-06T00:00:00Z", controller.signal)
    expect(run.status).toBe("cancelled")
    await storage.saveRun(run)
    expect((await storage.listRuns())[0]).toMatchObject({ id: "cancelled", status: "cancelled", completedCount: 0, plannedCount: 20 })
  })

  it("최신순으로 나열하고 최근 MAX_STORED_RUNS개만 유지한다", async () => {
    const storage = await freshStorage()
    const base = await makeRun("template", "2026-01-01T00:00:00Z")
    for (let i = 0; i < MAX_STORED_RUNS + 3; i++) {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
      await storage.saveRun({ ...base, id: `run-${i}`, createdAt })
    }
    const list = await storage.listRuns()
    expect(list).toHaveLength(MAX_STORED_RUNS)
    expect(list[0].id).toBe(`run-${MAX_STORED_RUNS + 2}`)
    expect(list.at(-1)?.id).toBe("run-3")
    expect(await storage.getRun("run-0")).toBeUndefined()
    expect(list[0].passCounts).toEqual([
      { variantName: "Prompt A", passCount: 5, n: 10 },
      { variantName: "Prompt B", passCount: 9, n: 10 },
    ])
  })

  it("저장된 run은 이후 prompt 수정과 무관하게 의미를 유지한다", async () => {
    const storage = await freshStorage()
    const run = await makeRun("r1", "2026-10-06T00:00:00Z")
    await storage.saveRun(run)
    run.variantSnapshots[0].promptTemplate = "mutated {{input}}"
    expect((await storage.getRun("r1"))?.variantSnapshots[0].promptTemplate).toBe(classificationPreset.variantA.promptTemplate)
  })

  it("prompt variant 편집본과 workspace를 저장 / 복원한다", async () => {
    const storage = await freshStorage()
    const edited = { ...classificationPreset.variantA, promptTemplate: "edited {{input}}" }
    await storage.saveVariants("classification", { A: edited, B: classificationPreset.variantB })
    expect(await storage.loadVariants("classification")).toEqual({ A: edited, B: classificationPreset.variantB })
    expect(await storage.loadVariants("other")).toEqual({})

    expect(await storage.loadWorkspace()).toBeUndefined()
    await storage.saveWorkspace({ presetId: "structured-json", providerMode: "ollama", ollamaModel: "llama3.2:1b" })
    expect(await storage.loadWorkspace()).toEqual({ presetId: "structured-json", providerMode: "ollama", ollamaModel: "llama3.2:1b" })
  })

  it("run 삭제", async () => {
    const storage = await freshStorage()
    await storage.saveRun(await makeRun("r1", "2026-10-06T00:00:00Z"))
    await storage.deleteRun("r1")
    expect(await storage.listRuns()).toEqual([])
  })
})
