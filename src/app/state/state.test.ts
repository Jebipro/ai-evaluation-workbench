import { describe, expect, it } from "vitest"
import { jsonPreset } from "../../core/presets.ts"
import { InvalidTransitionError } from "../../core/status.ts"
import { initialRunState, runReducer } from "./runState.ts"
import { createInitialWorkbenchState, workbenchReducer } from "./workbenchState.ts"
import { buildRunInput } from "../runtime.ts"

describe("runReducer", () => {
  const active = { dataset: jsonPreset.dataset, variants: [jsonPreset.variantA] }

  it("start → validating, 이전 validation issue 초기화", () => {
    const state = runReducer({ ...initialRunState, validationIssues: [{ path: "x", message: "y" }] }, { type: "start", active })
    expect(state.status).toBe("validating")
    expect(state.validationIssues).toEqual([])
  })

  it("실행 중에는 start를 거부한다 (중복 run 방지)", () => {
    expect(() => runReducer({ ...initialRunState, status: "running" }, { type: "start", active })).toThrow(InvalidTransitionError)
  })

  it("validationFailed → idle + issue 목록", () => {
    const started = runReducer(initialRunState, { type: "start", active })
    const failed = runReducer(started, { type: "validationFailed", issues: [{ path: "p", message: "m" }] })
    expect(failed.status).toBe("idle")
    expect(failed.active).toBeUndefined()
    expect(failed.validationIssues).toHaveLength(1)
  })

  it("progress의 latest 결과를 누적한다", () => {
    const result = { testCaseId: "c", variantId: "v", renderedPrompt: "p", score: 1, passed: true, reason: "", attempts: 1 }
    const state = runReducer(
      { ...initialRunState, status: "running" },
      { type: "progress", progress: { status: "running", plannedCount: 4, completedCount: 1, latest: result } },
    )
    expect(state.liveResults).toEqual([result])
    expect(state.completedCount).toBe(1)
  })
})

describe("workbenchReducer", () => {
  it("preset 선택 시 dataset과 prompt를 preset 기본값으로 바꾼다", () => {
    const state = workbenchReducer(createInitialWorkbenchState(), { type: "selectPreset", presetId: jsonPreset.id })
    expect(state.dataset.id).toBe(jsonPreset.dataset.id)
    expect(state.variants.B.promptTemplate).toBe(jsonPreset.variantB.promptTemplate)
  })

  it("prompt 편집과 되돌리기", () => {
    const initial = createInitialWorkbenchState()
    const edited = workbenchReducer(initial, { type: "editVariant", slot: "A", patch: { promptTemplate: "x {{input}}" } })
    expect(edited.variants.A.promptTemplate).toBe("x {{input}}")
    expect(edited.variants.B).toBe(initial.variants.B)
    const reset = workbenchReducer(edited, { type: "resetVariant", slot: "A" })
    expect(reset.variants.A.promptTemplate).toBe(initial.variants.A.promptTemplate)
  })

  it("Ollama mode에서는 fault simulation을 끄고 variant provider를 ollama로 바꾼다", () => {
    let state = workbenchReducer(createInitialWorkbenchState(), { type: "setFaultSimulation", enabled: true })
    state = workbenchReducer(state, { type: "setProviderMode", mode: "ollama" })
    state = workbenchReducer(state, { type: "setOllamaModel", model: " llama3.2:1b " })
    expect(state.faultSimulation).toBe(false)
    const input = buildRunInput(state)
    expect(input.variants.map((v) => v.modelConfig)).toEqual([
      { provider: "ollama", model: "llama3.2:1b", temperature: 0, seed: 42 },
      { provider: "ollama", model: "llama3.2:1b", temperature: 0, seed: 42 },
    ])
  })
})
