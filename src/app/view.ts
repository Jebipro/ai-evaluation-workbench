import { compareVariants, summarizeRun, type Comparison } from "../core/summary.ts"
import type { CaseResult, PromptVariant, ProviderDescriptor, RunSummary, TestCase } from "../core/types.ts"
import type { RunState } from "./state/runState.ts"

// 화면에 보여줄 결과 view-model. 실행 중이면 live 결과, 아니면 마지막 run의 snapshot을 쓴다.
// 집계는 core의 summarizeRun / compareVariants를 그대로 사용한다.

export type ResultsView = {
  live: boolean
  datasetName: string
  cases: TestCase[]
  variants: PromptVariant[]
  results: CaseResult[]
  summary: RunSummary
  comparison?: Comparison
  providers: ProviderDescriptor[]
  createdAt?: string
}

export function buildResultsView(state: RunState): ResultsView | undefined {
  if (state.active) {
    const { dataset, variants } = state.active
    return makeView(true, dataset.name, dataset.cases, variants, state.liveResults, [])
  }
  if (state.run) {
    const { datasetSnapshot, variantSnapshots, caseResults, providerSnapshot, createdAt } = state.run
    const view = makeView(false, datasetSnapshot.name, datasetSnapshot.cases, variantSnapshots, caseResults, providerSnapshot)
    return { ...view, summary: state.run.summary, createdAt }
  }
  return undefined
}

function makeView(
  live: boolean,
  datasetName: string,
  cases: TestCase[],
  variants: PromptVariant[],
  results: CaseResult[],
  providers: ProviderDescriptor[],
): ResultsView {
  const summary = summarizeRun(variants, cases.length, results)
  const comparison =
    variants.length >= 2
      ? compareVariants(
          cases.map((c) => c.id),
          results,
          variants[0].id,
          variants[1].id,
        )
      : undefined
  return { live, datasetName, cases, variants, results, summary, comparison, providers }
}

export function findResult(view: ResultsView, caseId: string, variantId: string): CaseResult | undefined {
  return view.results.find((r) => r.testCaseId === caseId && r.variantId === variantId)
}

// ---------------------------------------------------------------------------
// 형식화. 값이 없으면 N/A (가짜 숫자를 만들지 않는다)
// ---------------------------------------------------------------------------

export function formatPercent(rate: number | undefined): string {
  return rate === undefined ? "N/A" : `${Math.round(rate * 1000) / 10}%`
}

export function formatScore(score: number | undefined): string {
  return score === undefined ? "N/A" : score.toFixed(2)
}

export function formatMs(ms: number | undefined): string {
  return ms === undefined ? "N/A" : `${Math.round(ms)} ms`
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return ""
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("ko-KR")
}

export const VARIANT_SLOTS = ["A", "B"] as const

export function slotLabel(index: number): string {
  return VARIANT_SLOTS[index] ?? String(index + 1)
}
