import { DemoProvider, DEMO_MODEL, DEMO_PROVIDER_ID } from "../core/providers/demo.ts"
import { DEFAULT_DEMO_FAULT_PLAN, FaultInjectingProvider } from "../core/providers/faultInjecting.ts"
import { ProxyProvider } from "../core/providers/proxy.ts"
import { DEFAULT_RUN_CONFIG, runEvaluation, type RunInput } from "../core/runner.ts"
import type { ModelProvider, PromptVariant } from "../core/types.ts"
import type { ProviderMode, WorkbenchState } from "./state/workbenchState.ts"

// UI가 core를 사용하는 경계. 테스트에서 주입해 바꿀 수 있다.

export type ProviderOptions = {
  faultSimulation: boolean
  ollamaModel: string
}

export type Runtime = {
  runEvaluation: typeof runEvaluation
  /** run마다 새로 만든다 (FaultInjectingProvider의 시도 counter 초기화) */
  createProviders: (options: ProviderOptions) => Record<string, ModelProvider>
}

export const OLLAMA_PROVIDER_ID = "ollama"

export function defaultCreateProviders(options: ProviderOptions): Record<string, ModelProvider> {
  const demo = new DemoProvider()
  return {
    [DEMO_PROVIDER_ID]: options.faultSimulation ? new FaultInjectingProvider(demo, DEFAULT_DEMO_FAULT_PLAN) : demo,
    [OLLAMA_PROVIDER_ID]: new ProxyProvider({ model: options.ollamaModel }),
  }
}

export const defaultRuntime: Runtime = {
  runEvaluation,
  createProviders: defaultCreateProviders,
}

/** 화면의 provider 선택을 variant의 modelConfig에 반영한다. */
export function applyProviderMode(variant: PromptVariant, mode: ProviderMode, ollamaModel: string): PromptVariant {
  if (mode === "ollama") {
    return { ...variant, modelConfig: { ...variant.modelConfig, provider: OLLAMA_PROVIDER_ID, model: ollamaModel.trim() } }
  }
  return { ...variant, modelConfig: { ...variant.modelConfig, provider: DEMO_PROVIDER_ID, model: DEMO_MODEL } }
}

export function buildRunInput(state: WorkbenchState): RunInput {
  return {
    dataset: state.dataset,
    variants: [
      applyProviderMode(state.variants.A, state.providerMode, state.ollamaModel),
      applyProviderMode(state.variants.B, state.providerMode, state.ollamaModel),
    ],
    config: { ...DEFAULT_RUN_CONFIG },
  }
}
