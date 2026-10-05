import { getCaseOutcome } from "./status.ts"
import { compareVariants, type Comparison } from "./summary.ts"
import type { CaseOutcome, CaseResult, EvaluationRun, PromptVariant, ProviderDescriptor, RunConfig, RunStatus, RunSummary, TestCase } from "./types.ts"

// Evaluation Run export. 결과 순서는 run.caseResults의 안정적인 순서(case → variant)를 그대로 따른다.

export const EXPORT_SCHEMA_VERSION = 1

export type RunExport = {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  run: {
    id: string
    status: RunStatus
    createdAt: string
    finishedAt?: string
    plannedCount: number
    completedCount: number
    failureMessage?: string
    config: RunConfig
  }
  dataset: { id: string; name: string; cases: TestCase[] }
  variants: PromptVariant[]
  providers: ProviderDescriptor[]
  /** renderedPrompt 포함. outcome은 getCaseOutcome으로 파생한 값 */
  results: (CaseResult & { outcome: CaseOutcome })[]
  summary: RunSummary
  /** variant가 2개 이상일 때 첫 두 variant의 A/B 비교 (row는 case id / 분류만) */
  comparison?: { variantAId: string; variantBId: string; counts: Comparison["counts"]; rows: { testCaseId: string; category: string; differs: boolean }[] }
}

export function buildRunExport(run: EvaluationRun, exportedAt: Date = new Date()): RunExport {
  const [a, b] = run.variantSnapshots
  const comparison = a && b ? compareVariants(run.datasetSnapshot.cases.map((c) => c.id), run.caseResults, a.id, b.id) : undefined
  return structuredClone({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    run: {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      plannedCount: run.plannedCount,
      completedCount: run.summary.completedCount,
      failureMessage: run.failureMessage,
      config: run.config,
    },
    dataset: run.datasetSnapshot,
    variants: run.variantSnapshots,
    providers: run.providerSnapshot,
    results: run.caseResults.map((result) => ({ ...result, outcome: getCaseOutcome(result) })),
    summary: run.summary,
    comparison: comparison && {
      variantAId: comparison.variantAId,
      variantBId: comparison.variantBId,
      counts: comparison.counts,
      rows: comparison.rows.map((row) => ({ testCaseId: row.testCaseId, category: row.category, differs: row.differs })),
    },
  })
}

export const CSV_COLUMNS = [
  "case_id",
  "case_name",
  "variant_id",
  "variant_name",
  "outcome",
  "score",
  "passed",
  "reason",
  "latency_ms",
  "attempts",
  "error_kind",
] as const

function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return ""
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CaseResult당 1행. outcome은 PASS | FAIL | ERROR */
export function buildRunCsv(run: EvaluationRun): string {
  const caseNames = new Map(run.datasetSnapshot.cases.map((c) => [c.id, c.name]))
  const variantNames = new Map(run.variantSnapshots.map((v) => [v.id, v.name]))
  const lines = [CSV_COLUMNS.join(",")]
  for (const result of run.caseResults) {
    const row = [
      result.testCaseId,
      caseNames.get(result.testCaseId),
      result.variantId,
      variantNames.get(result.variantId),
      getCaseOutcome(result).toUpperCase(),
      result.score,
      result.passed,
      result.reason,
      result.latencyMs === undefined ? undefined : Math.round(result.latencyMs),
      result.error?.attempts ?? result.attempts,
      result.error?.kind,
    ]
    lines.push(row.map(csvCell).join(","))
  }
  return `${lines.join("\r\n")}\r\n`
}

export function exportFileBaseName(run: EvaluationRun): string {
  const stamp = run.createdAt.replace(/[:.]/g, "-")
  return `evaluation-run-${stamp}-${run.status}`
}
