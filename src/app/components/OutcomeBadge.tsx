import type { CaseOutcome } from "../../core/types.ts"

const LABEL: Record<CaseOutcome, { icon: string; text: string; title: string }> = {
  pass: { icon: "✓", text: "PASS", title: "evaluator 통과" },
  fail: { icon: "✕", text: "FAIL", title: "output을 받았지만 evaluator 기준 미달 (evaluator fail)" },
  error: { icon: "⚠", text: "ERROR", title: "사용 가능한 output을 받지 못함 (execution error)" },
}

/** PASS / FAIL / ERROR를 색만이 아니라 아이콘 + 텍스트로 표시한다. */
export function OutcomeBadge({ outcome }: { outcome: CaseOutcome | undefined }) {
  if (outcome === undefined) {
    return (
      <span className="badge badge-pending" title="결과 없음 (미실행 또는 취소)">
        <span aria-hidden="true">–</span> 결과 없음
      </span>
    )
  }
  const { icon, text, title } = LABEL[outcome]
  return (
    <span className={`badge badge-${outcome}`} title={title}>
      <span aria-hidden="true">{icon}</span> {text}
    </span>
  )
}

/**
 * A / B를 색 외에 글자로도 구분하는 tag. 주변 텍스트가 이미 "Prompt A"라고 말하면 시각 전용으로 두고,
 * 그렇지 않은 곳(table header, bar)에서는 announce로 screen reader용 이름을 붙인다.
 */
export function VariantTag({ slot, announce = false }: { slot: string; announce?: boolean }) {
  return (
    <>
      <span className={`variant-tag variant-tag-${slot.toLowerCase()}`} aria-hidden="true">
        {slot}
      </span>
      {announce && <span className="visually-hidden">Prompt {slot}</span>}
    </>
  )
}
