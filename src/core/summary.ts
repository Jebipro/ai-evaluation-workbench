import { getCaseOutcome } from "./status.ts"
import type { CaseOutcome, CaseResult, PromptVariant, RunSummary, UsageStat, VariantSummary } from "./types.ts"

// Summary 집계 규칙
// - n = completedCount (ERROR 포함, 취소로 실행되지 않은 case는 제외)
// - passRate 분모 n. ERROR는 비통과로 집계
// - averageScore: ERROR는 0점으로 포함
// - averageLatencyMs: latency 값이 있는 성공 실행만 (ERROR 제외)
// - usage: 실제 값이 있는 case만, coverage = 값이 있는 case 수

function usageStat(values: number[]): UsageStat | undefined {
  if (values.length === 0) return undefined
  const total = values.reduce((sum, v) => sum + v, 0)
  return { total, average: total / values.length, count: values.length }
}

export function summarizeVariant(variant: Pick<PromptVariant, "id" | "name">, results: readonly CaseResult[], plannedCount: number): VariantSummary {
  const own = results.filter((r) => r.variantId === variant.id)
  const n = own.length
  let passCount = 0
  let evalFailCount = 0
  let errorCount = 0
  for (const result of own) {
    const outcome = getCaseOutcome(result)
    if (outcome === "pass") passCount++
    else if (outcome === "fail") evalFailCount++
    else errorCount++
  }
  const latencies = own
    .filter((r) => !r.error && r.latencyMs !== undefined)
    .map((r) => r.latencyMs as number)
  const withUsage = own.filter((r) => !r.error && r.usage && (r.usage.inputTokens !== undefined || r.usage.outputTokens !== undefined))
  const inputTokens = withUsage.map((r) => r.usage?.inputTokens).filter((v): v is number => v !== undefined)
  const outputTokens = withUsage.map((r) => r.usage?.outputTokens).filter((v): v is number => v !== undefined)
  const scoreTotal = own.reduce((sum, r) => sum + (r.error ? 0 : r.score), 0)

  return {
    variantId: variant.id,
    variantName: variant.name,
    plannedCount,
    n,
    passCount,
    passRate: n === 0 ? undefined : passCount / n,
    averageScore: n === 0 ? undefined : scoreTotal / n,
    evalFailCount,
    errorCount,
    averageLatencyMs: latencies.length === 0 ? undefined : latencies.reduce((s, v) => s + v, 0) / latencies.length,
    latencySampleCount: latencies.length,
    usage: {
      inputTokens: usageStat(inputTokens),
      outputTokens: usageStat(outputTokens),
      coverage: withUsage.length,
    },
  }
}

export function summarizeRun(
  variants: readonly Pick<PromptVariant, "id" | "name">[],
  caseCount: number,
  results: readonly CaseResult[],
): RunSummary {
  const variantSummaries = variants.map((variant) => summarizeVariant(variant, results, caseCount))
  return {
    plannedCount: caseCount * variants.length,
    completedCount: results.length,
    passCount: variantSummaries.reduce((s, v) => s + v.passCount, 0),
    evalFailCount: variantSummaries.reduce((s, v) => s + v.evalFailCount, 0),
    errorCount: variantSummaries.reduce((s, v) => s + v.errorCount, 0),
    variants: variantSummaries,
  }
}

// ---------------------------------------------------------------------------
// A/B 비교
// ---------------------------------------------------------------------------

export type ComparisonCategory =
  | "both-pass"
  | "a-only"
  | "b-only"
  | "both-not-pass"
  | "has-error"
  /** 취소 등으로 한쪽 이상 결과가 없음 */
  | "incomplete"

export type ComparisonRow = {
  testCaseId: string
  a?: CaseResult
  b?: CaseResult
  outcomeA?: CaseOutcome
  outcomeB?: CaseOutcome
  category: ComparisonCategory
  /** outcome 또는 score가 다름 */
  differs: boolean
}

export type Comparison = {
  variantAId: string
  variantBId: string
  rows: ComparisonRow[]
  counts: Record<ComparisonCategory, number>
}

export function categorize(outcomeA: CaseOutcome | undefined, outcomeB: CaseOutcome | undefined): ComparisonCategory {
  if (outcomeA === undefined || outcomeB === undefined) return "incomplete"
  if (outcomeA === "error" || outcomeB === "error") return "has-error"
  if (outcomeA === "pass" && outcomeB === "pass") return "both-pass"
  if (outcomeA === "pass") return "a-only"
  if (outcomeB === "pass") return "b-only"
  return "both-not-pass"
}

export function compareVariants(
  caseIds: readonly string[],
  results: readonly CaseResult[],
  variantAId: string,
  variantBId: string,
): Comparison {
  const counts: Record<ComparisonCategory, number> = {
    "both-pass": 0,
    "a-only": 0,
    "b-only": 0,
    "both-not-pass": 0,
    "has-error": 0,
    incomplete: 0,
  }
  const find = (caseId: string, variantId: string) =>
    results.find((r) => r.testCaseId === caseId && r.variantId === variantId)
  const rows = caseIds.map((testCaseId): ComparisonRow => {
    const a = find(testCaseId, variantAId)
    const b = find(testCaseId, variantBId)
    const outcomeA = a ? getCaseOutcome(a) : undefined
    const outcomeB = b ? getCaseOutcome(b) : undefined
    const category = categorize(outcomeA, outcomeB)
    counts[category]++
    const differs = outcomeA !== outcomeB || (a !== undefined && b !== undefined && a.score !== b.score)
    return { testCaseId, a, b, outcomeA, outcomeB, category, differs }
  })
  return { variantAId, variantBId, rows, counts }
}

export function formatPassRate(summary: Pick<VariantSummary, "passCount" | "n" | "passRate">): string {
  if (summary.n === 0 || summary.passRate === undefined) return `${summary.passCount} / ${summary.n} (N/A)`
  return `${summary.passCount} / ${summary.n} (${Math.round(summary.passRate * 1000) / 10}%)`
}
