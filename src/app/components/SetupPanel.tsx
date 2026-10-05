import { useId } from "react"
import { PRESETS } from "../../core/presets.ts"
import { DEMO_MODEL } from "../../core/providers/demo.ts"
import type { WorkbenchAction, WorkbenchState } from "../state/workbenchState.ts"
import { PromptEditor } from "./PromptEditor.tsx"

type Props = {
  state: WorkbenchState
  dispatch: (action: WorkbenchAction) => void
  disabled: boolean
}

export function SetupPanel({ state, dispatch, disabled }: Props) {
  const id = useId()
  const { dataset } = state
  return (
    <section className="panel setup" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Setup</h2>

      <fieldset className="preset-picker" disabled={disabled}>
        <legend>Test Dataset</legend>
        <div className="preset-options">
          {PRESETS.map((preset) => (
            <label key={preset.id} className={`preset-option ${preset.id === state.presetId ? "is-selected" : ""}`}>
              <input
                type="radio"
                name={`${id}-preset`}
                value={preset.id}
                checked={preset.id === state.presetId}
                onChange={() => dispatch({ type: "selectPreset", presetId: preset.id })}
              />
              <span className="preset-option-body">
                <strong>{preset.title}</strong>
                <span className="preset-option-meta">
                  {preset.dataset.name} · {preset.dataset.cases.length} cases
                </span>
                <span className="preset-option-summary">{preset.summary}</span>
              </span>
            </label>
          ))}
        </div>
        {dataset.description && <p className="dataset-description">{dataset.description}</p>}
      </fieldset>

      <fieldset className="provider-picker" disabled={disabled}>
        <legend>Provider / Model</legend>
        <div className="provider-row">
          <label htmlFor={`${id}-provider`}>Provider</label>
          <select
            id={`${id}-provider`}
            value={state.providerMode}
            onChange={(e) => dispatch({ type: "setProviderMode", mode: e.target.value as WorkbenchState["providerMode"] })}
          >
            <option value="demo">Demo (규칙 기반 시뮬레이션)</option>
            <option value="ollama">Ollama (local server 경유)</option>
          </select>
          {state.providerMode === "demo" ? (
            <span className="provider-model">
              model: <code>{DEMO_MODEL}</code>
            </span>
          ) : (
            <>
              <label htmlFor={`${id}-ollama-model`}>Model</label>
              <input
                id={`${id}-ollama-model`}
                type="text"
                placeholder="예: llama3.2:1b"
                value={state.ollamaModel}
                onChange={(e) => dispatch({ type: "setOllamaModel", model: e.target.value })}
              />
            </>
          )}
        </div>
        {state.providerMode === "ollama" && (
          <p className="hint">
            <code>npm run server</code>로 local server를 띄우고 Ollama가 실행 중이어야 합니다. temperature 0, seed 42로
            요청합니다 (완전한 결정성은 보장되지 않음).
          </p>
        )}
        {state.providerMode === "demo" && (
          <div className="fault-toggle">
            <label>
              <input
                type="checkbox"
                checked={state.faultSimulation}
                onChange={(e) => dispatch({ type: "setFaultSimulation", enabled: e.target.checked })}
              />{" "}
              인프라 오류 시뮬레이션
            </label>
            {state.faultSimulation && (
              <p className="fault-notice" role="note">
                <span aria-hidden="true">⚠</span> 시뮬레이션된 인프라 오류(429 / 5xx)이며 평가 점수 조작이 아닙니다. 일부
                prompt는 retry 후 성공하고, 일부는 retry를 소진해 ERROR가 됩니다.
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="prompt-grid">
        {(["A", "B"] as const).map((slot) => (
          <PromptEditor
            key={slot}
            slot={slot}
            variant={state.variants[slot]}
            disabled={disabled}
            onChange={(patch) => dispatch({ type: "editVariant", slot, patch })}
            onReset={() => dispatch({ type: "resetVariant", slot })}
          />
        ))}
      </div>
    </section>
  )
}
