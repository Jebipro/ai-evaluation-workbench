import { useState } from "react"
import { getCaseOutcome } from "../../core/status.ts"
import { formatScore, slotLabel, type ResultsView } from "../view.ts"
import { OutcomeBadge, VariantTag } from "./OutcomeBadge.tsx"

type Props = {
  view: ResultsView
  selectedCaseId?: string
  onOpen: (caseId: string) => void
}

export function CaseTable({ view, selectedCaseId, onOpen }: Props) {
  const [onlyDiffs, setOnlyDiffs] = useState(false)
  const rows = view.comparison?.rows ?? []
  const caseById = new Map(view.cases.map((c) => [c.id, c]))
  const visible = onlyDiffs ? rows.filter((row) => row.differs) : rows
  const diffCount = rows.filter((row) => row.differs).length
  const [a, b] = view.variants

  return (
    <section className="panel cases" aria-labelledby="cases-title">
      <div className="panel-heading">
        <h2 id="cases-title">Cases</h2>
        <label className="diff-filter">
          <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} /> 차이 있는 case만 (
          {diffCount})
        </label>
      </div>
      <div className="table-scroll">
        <table className="case-table">
          <caption className="visually-hidden">
            case별 Prompt A / Prompt B 결과. PASS, FAIL, ERROR는 아이콘과 텍스트로 표시합니다.
          </caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">
                <VariantTag slot="A" announce /> 결과
              </th>
              <th scope="col" className="num">
                A score
              </th>
              <th scope="col">
                <VariantTag slot="B" announce /> 결과
              </th>
              <th scope="col" className="num">
                B score
              </th>
              <th scope="col">차이</th>
              <th scope="col">
                <span className="visually-hidden">상세</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  {onlyDiffs ? "A와 B의 결과가 다른 case가 없습니다." : "표시할 case가 없습니다."}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const testCase = caseById.get(row.testCaseId)
              const name = testCase?.name ?? row.testCaseId
              return (
                <tr key={row.testCaseId} className={row.testCaseId === selectedCaseId ? "is-selected" : undefined}>
                  <th scope="row">
                    <span className="case-name">{name}</span>
                    {testCase?.tags && testCase.tags.length > 0 && (
                      <span className="tags">
                        {testCase.tags.map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </th>
                  <td>
                    <OutcomeBadge outcome={row.a ? getCaseOutcome(row.a) : undefined} />
                  </td>
                  <td className="num">{formatScore(row.a?.score)}</td>
                  <td>
                    <OutcomeBadge outcome={row.b ? getCaseOutcome(row.b) : undefined} />
                  </td>
                  <td className="num">{formatScore(row.b?.score)}</td>
                  <td>{row.differs ? <strong className="diff-yes">차이 있음</strong> : <span className="muted">같음</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="button-small"
                      onClick={() => onOpen(row.testCaseId)}
                      aria-label={`${name} 상세 보기`}
                    >
                      상세
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {a && b && (
        <p className="muted table-legend">
          <VariantTag slot={slotLabel(0)} /> {a.name} · <VariantTag slot={slotLabel(1)} /> {b.name}
        </p>
      )}
    </section>
  )
}
