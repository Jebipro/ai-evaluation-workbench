import { useId } from "react"
import type { PromptVariant } from "../../core/types.ts"
import type { VariantSlot } from "../state/workbenchState.ts"
import { VariantTag } from "./OutcomeBadge.tsx"

type Props = {
  slot: VariantSlot
  variant: PromptVariant
  disabled: boolean
  onChange: (patch: Partial<Pick<PromptVariant, "systemPrompt" | "promptTemplate">>) => void
  onReset: () => void
}

export function PromptEditor({ slot, variant, disabled, onChange, onReset }: Props) {
  const id = useId()
  return (
    <fieldset className={`prompt-editor prompt-editor-${slot.toLowerCase()}`} disabled={disabled}>
      <legend>
        <VariantTag slot={slot} /> Prompt {slot}
      </legend>
      <label htmlFor={`${id}-system`}>System prompt (선택)</label>
      <textarea
        id={`${id}-system`}
        rows={2}
        value={variant.systemPrompt ?? ""}
        onChange={(e) => onChange({ systemPrompt: e.target.value === "" ? undefined : e.target.value })}
      />
      <label htmlFor={`${id}-template`}>
        Prompt template <span className="hint">— <code>{"{{input}}"}</code> 자리에 test case input이 들어갑니다</span>
      </label>
      <textarea
        id={`${id}-template`}
        rows={6}
        value={variant.promptTemplate}
        onChange={(e) => onChange({ promptTemplate: e.target.value })}
      />
      <div className="prompt-editor-footer">
        <button type="button" className="button-link" onClick={onReset}>
          Prompt {slot} 기본값으로 되돌리기
        </button>
      </div>
    </fieldset>
  )
}
