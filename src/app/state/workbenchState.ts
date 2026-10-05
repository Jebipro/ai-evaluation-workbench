import { PRESETS, type Preset } from "../../core/presets.ts"
import type { Dataset, PromptVariant } from "../../core/types.ts"

// UI / setup state: 어떤 dataset과 prompt를 실행할지, 어떤 case detail을 보고 있는지.

export type VariantSlot = "A" | "B"
export type ProviderMode = "demo" | "ollama"
export type VariantPair = Record<VariantSlot, PromptVariant>

export type WorkbenchState = {
  presetId: string
  dataset: Dataset
  /** 현재 preset의 Prompt A / B */
  variants: VariantPair
  /** 다른 preset으로 전환해도 편집본을 잃지 않도록 preset별 편집본을 보관 */
  drafts: Record<string, VariantPair>
  providerMode: ProviderMode
  ollamaModel: string
  faultSimulation: boolean
  selectedCaseId?: string
}

export type WorkbenchAction =
  | { type: "selectPreset"; presetId: string }
  | { type: "editVariant"; slot: VariantSlot; patch: Partial<Pick<PromptVariant, "systemPrompt" | "promptTemplate">> }
  | { type: "resetVariant"; slot: VariantSlot }
  | { type: "setFaultSimulation"; enabled: boolean }
  | { type: "setProviderMode"; mode: ProviderMode }
  | { type: "setOllamaModel"; model: string }
  | { type: "openCase"; caseId: string }
  | { type: "closeCase" }
  | {
      type: "restore"
      state: { presetId?: string; providerMode?: ProviderMode; ollamaModel?: string; drafts?: Record<string, VariantPair> }
    }

export function findPreset(presetId: string): Preset {
  return PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
}

function presetVariants(preset: Preset): VariantPair {
  return { A: structuredClone(preset.variantA), B: structuredClone(preset.variantB) }
}

export function createInitialWorkbenchState(presetId: string = PRESETS[0].id): WorkbenchState {
  const preset = findPreset(presetId)
  return {
    presetId: preset.id,
    dataset: structuredClone(preset.dataset),
    variants: presetVariants(preset),
    drafts: {},
    providerMode: "demo",
    ollamaModel: "",
    faultSimulation: false,
  }
}

function withVariants(state: WorkbenchState, variants: VariantPair): WorkbenchState {
  return { ...state, variants, drafts: { ...state.drafts, [state.presetId]: variants } }
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "selectPreset": {
      const preset = findPreset(action.presetId)
      const drafts = { ...state.drafts, [state.presetId]: state.variants }
      return {
        ...state,
        presetId: preset.id,
        dataset: structuredClone(preset.dataset),
        variants: drafts[preset.id] ?? presetVariants(preset),
        drafts,
        selectedCaseId: undefined,
      }
    }
    case "editVariant":
      return withVariants(state, { ...state.variants, [action.slot]: { ...state.variants[action.slot], ...action.patch } })
    case "resetVariant": {
      const preset = findPreset(state.presetId)
      const original = action.slot === "A" ? preset.variantA : preset.variantB
      return withVariants(state, { ...state.variants, [action.slot]: structuredClone(original) })
    }
    case "setFaultSimulation":
      return { ...state, faultSimulation: action.enabled }
    case "setProviderMode":
      return { ...state, providerMode: action.mode, faultSimulation: action.mode === "demo" ? state.faultSimulation : false }
    case "setOllamaModel":
      return { ...state, ollamaModel: action.model }
    case "openCase":
      return { ...state, selectedCaseId: action.caseId }
    case "closeCase":
      return { ...state, selectedCaseId: undefined }
    case "restore": {
      const preset = findPreset(action.state.presetId ?? state.presetId)
      const drafts = { ...state.drafts, ...action.state.drafts }
      return {
        ...state,
        providerMode: action.state.providerMode ?? state.providerMode,
        ollamaModel: action.state.ollamaModel ?? state.ollamaModel,
        presetId: preset.id,
        dataset: structuredClone(preset.dataset),
        variants: drafts[preset.id] ?? presetVariants(preset),
        drafts,
        faultSimulation: (action.state.providerMode ?? state.providerMode) === "demo" ? state.faultSimulation : false,
      }
    }
  }
}
