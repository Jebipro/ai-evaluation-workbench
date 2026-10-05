import { useEffect, useRef } from "react"
import { getThreshold } from "../../core/evaluators.ts"
import { getCaseOutcome } from "../../core/status.ts"
import { renderTemplate } from "../../core/template.ts"
import type { CaseResult, EvaluatorConfig, PromptVariant, TestCase } from "../../core/types.ts"
import { findResult, formatMs, formatScore, slotLabel, type ResultsView } from "../view.ts"
import { OutcomeBadge, VariantTag } from "./OutcomeBadge.tsx"

type Props = {
  view: ResultsView
  caseId: string
  onClose: () => void
}

function describeEvaluator(config: EvaluatorConfig): string {
  const threshold = `threshold ${getThreshold(config)}`
  switch (config.type) {
    case "exact-match":
    case "contains":
      return `${config.type} · expected "${config.expected}" · ${threshold}`
    case "regex":
      return `regex /${config.pattern}/${config.flags ?? ""} · ${threshold}`
    case "json-valid":
      return `json-valid (strict, fence 불허) · ${threshold}`
    case "json-fields":
      return `json-fields (strict, rule ${config.rules.length}개) · ${threshold}`
  }
}

function isSimulated(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { simulated?: unknown }).simulated === true
}

function VariantResult({ slot, variant, testCase, result }: { slot: string; variant: PromptVariant; testCase: TestCase; result?: CaseResult }) {
  const renderedPrompt = result?.renderedPrompt ?? renderTemplate(variant.promptTemplate, testCase.input)
  return (
    <section className={`detail-variant detail-variant-${slot.toLowerCase()}`} aria-label={`Prompt ${slot} 결과`}>
      <header>
        <VariantTag slot={slot} /> <h4>{variant.name}</h4>
        <OutcomeBadge outcome={result ? getCaseOutcome(result) : undefined} />
      </header>
      {variant.systemPrompt && (
        <>
          <h5>System prompt</h5>
          <pre className="code-block">{variant.systemPrompt}</pre>
        </>
      )}
      <h5>Rendered prompt{result ? "" : " (미실행 — 현재 template 기준 미리보기)"}</h5>
      <pre className="code-block" data-testid={`rendered-prompt-${slot}`}>
        {renderedPrompt}
      </pre>
      {!result && <p className="muted">이 case는 실행되지 않았습니다 (취소 또는 실행 중).</p>}
      {result && !result.error && (
        <>
          <h5>Output</h5>
          <pre className="code-block">{result.output}</pre>
        </>
      )}
      {result?.error && (
        <div className="error-box" role="note">
          <h5>
            <span aria-hidden="true">⚠</span> 실행 오류 (execution error) — output 없음, evaluator 미실행
          </h5>
          <dl className="metrics">
            <dt>kind</dt>
            <dd>
              <code>{result.error.kind}</code>
            </dd>
            <dt>attempts</dt>
            <dd>{result.error.attempts}</dd>
            {result.error.httpStatus !== undefined && (
              <>
                <dt>HTTP status</dt>
                <dd>{result.error.httpStatus}</dd>
              </>
            )}
            <dt>message</dt>
            <dd>{result.error.message}</dd>
          </dl>
        </div>
      )}
      {result && (
        <dl className="metrics">
          <dt>score</dt>
          <dd>{formatScore(result.score)}</dd>
          <dt>reason</dt>
          <dd>{result.reason}</dd>
          <dt>latency</dt>
          <dd>
            {formatMs(result.latencyMs)}
            {result.latencyMs === undefined && isSimulated(result.raw) && <span className="muted"> (simulated)</span>}
          </dd>
          <dt>usage</dt>
          <dd>
            {result.usage
              ? `in ${result.usage.inputTokens ?? "N/A"} / out ${result.usage.outputTokens ?? "N/A"}`
              : "N/A"}
          </dd>
          {!result.error && (
            <>
              <dt>attempts</dt>
              <dd>{result.attempts}</dd>
            </>
          )}
        </dl>
      )}
      {result?.raw !== undefined && (
        <details>
          <summary>raw metadata</summary>
          <pre className="code-block">{JSON.stringify(result.raw, null, 2)}</pre>
        </details>
      )}
    </section>
  )
}

export function CaseDetail({ view, caseId, onClose }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const testCase = view.cases.find((c) => c.id === caseId)

  useEffect(() => {
    headingRef.current?.focus()
  }, [caseId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!testCase) return null
  return (
    <section className="panel case-detail" role="region" aria-labelledby="case-detail-title">
      <div className="panel-heading">
        <h2 id="case-detail-title" ref={headingRef} tabIndex={-1}>
          Case detail · {testCase.name}
        </h2>
        <button type="button" className="button-secondary" onClick={onClose}>
          닫기
        </button>
      </div>
      <dl className="metrics case-meta">
        <dt>id</dt>
        <dd>
          <code>{testCase.id}</code>
        </dd>
        <dt>evaluator</dt>
        <dd>{describeEvaluator(testCase.evaluator)}</dd>
      </dl>
      <h3>Input</h3>
      <pre className="code-block">{testCase.input}</pre>
      {testCase.evaluator.type === "json-fields" && (
        <>
          <h3>Rules</h3>
          <pre className="code-block">{JSON.stringify(testCase.evaluator.rules, null, 2)}</pre>
        </>
      )}
      <div className="detail-grid">
        {view.variants.slice(0, 2).map((variant, index) => (
          <VariantResult
            key={variant.id}
            slot={slotLabel(index)}
            variant={variant}
            testCase={testCase}
            result={findResult(view, testCase.id, variant.id)}
          />
        ))}
      </div>
    </section>
  )
}
