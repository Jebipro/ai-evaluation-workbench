import { formatPassRate, type ComparisonCategory } from "../../core/summary.ts"
import type { VariantSummary } from "../../core/types.ts"
import { formatMs, formatPercent, formatScore, slotLabel, type ResultsView } from "../view.ts"
import { VariantTag } from "./OutcomeBadge.tsx"

const CATEGORY_LABEL: Record<ComparisonCategory, string> = {
  "both-pass": "둘 다 PASS",
  "a-only": "A만 PASS",
  "b-only": "B만 PASS",
  "both-not-pass": "둘 다 비통과",
  "has-error": "ERROR 포함",
  incomplete: "결과 없음",
}

function UsageLine({ summary }: { summary: VariantSummary }) {
  const { inputTokens, outputTokens, coverage } = summary.usage
  if (coverage === 0) return <dd>N/A</dd>
  return (
    <dd>
      in {inputTokens ? Math.round(inputTokens.average) : "N/A"} / out {outputTokens ? Math.round(outputTokens.average) : "N/A"} 평균
      <span className="muted"> (값 있는 case {coverage} / {summary.n})</span>
    </dd>
  )
}

function VariantCard({ summary, slot, simulated }: { summary: VariantSummary; slot: string; simulated: boolean }) {
  return (
    <article className={`variant-card variant-card-${slot.toLowerCase()}`} aria-label={`Prompt ${slot} summary`}>
      <header>
        <VariantTag slot={slot} /> <h3>{summary.variantName}</h3>
      </header>
      <p className="pass-rate">
        <span className="pass-rate-label">Pass rate</span>
        <strong>{formatPassRate(summary)}</strong>
      </p>
      <dl className="metrics">
        <dt>평균 score</dt>
        <dd>{formatScore(summary.averageScore)}</dd>
        <dt>
          <span aria-hidden="true">✕</span> FAIL
        </dt>
        <dd>{summary.evalFailCount}</dd>
        <dt>
          <span aria-hidden="true">⚠</span> ERROR
        </dt>
        <dd>{summary.errorCount}</dd>
        <dt>평균 latency</dt>
        <dd>
          {formatMs(summary.averageLatencyMs)}
          {simulated && summary.averageLatencyMs === undefined && <span className="muted"> (simulated)</span>}
        </dd>
        <dt>token usage</dt>
        <UsageLine summary={summary} />
        <dt>완료 / 계획</dt>
        <dd>
          {summary.n} / {summary.plannedCount}
        </dd>
      </dl>
    </article>
  )
}

function PassRateBars({ summaries }: { summaries: VariantSummary[] }) {
  return (
    <div className="bars" aria-label="Pass rate 비교">
      {summaries.map((summary, index) => {
        const slot = slotLabel(index)
        const width = summary.passRate === undefined ? 0 : summary.passRate * 100
        return (
          <div className="bar-row" key={summary.variantId}>
            <span className="bar-label">
              <VariantTag slot={slot} announce />
            </span>
            <div className="bar-track" aria-hidden="true">
              <div className={`bar-fill bar-fill-${slot.toLowerCase()}`} style={{ width: `${width}%` }} />
            </div>
            <span className="bar-value">
              {summary.passCount} / {summary.n} ({formatPercent(summary.passRate)})
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function SummaryPanel({ view }: { view: ResultsView }) {
  const simulated = view.live
    ? view.variants.some((v) => v.modelConfig.provider === "demo")
    : view.providers.some((p) => p.simulated)
  const summaries = view.summary.variants.slice(0, 2)
  const counts = view.comparison?.counts
  return (
    <section className="panel summary" aria-labelledby="summary-title">
      <div className="panel-heading">
        <h2 id="summary-title">A/B Summary</h2>
        <span className="muted">
          {view.datasetName} · {view.live ? "실행 중 (부분 결과)" : `n = ${view.summary.completedCount} / ${view.summary.plannedCount} 실행`}
        </span>
      </div>
      <div className="variant-cards">
        {summaries.map((summary, index) => (
          <VariantCard key={summary.variantId} summary={summary} slot={slotLabel(index)} simulated={simulated} />
        ))}
      </div>
      <PassRateBars summaries={summaries} />
      {counts && (
        <ul className="comparison-counts" aria-label="case별 A/B 비교">
          {(Object.keys(CATEGORY_LABEL) as ComparisonCategory[])
            .filter((category) => category !== "incomplete" || counts.incomplete > 0)
            .map((category) => (
              <li key={category}>
                <span className="comparison-count">{counts[category]}</span> {CATEGORY_LABEL[category]}
              </li>
            ))}
        </ul>
      )}
      <p className="caveat">
        test case {view.cases.length}개 규모의 비교입니다. 작은 test set에서 몇 case 차이는 통계적으로 유의미하다고 볼 수
        없습니다. FAIL은 output을 받았지만 기준 미달, ERROR는 output을 받지 못한 실행 오류입니다.
      </p>
    </section>
  )
}
