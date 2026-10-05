import { buildRunCsv, buildRunExport, exportFileBaseName } from "../../core/export.ts"
import type { EvaluationRun, RunStatus } from "../../core/types.ts"
import type { PersistenceStatus } from "../persistence/usePersistence.ts"
import type { RunListItem } from "../persistence/storage.ts"
import { formatDateTime } from "../view.ts"

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: "대기",
  validating: "검증 중",
  running: "실행 중",
  completed: "정상 완료",
  partiallyFailed: "일부 실행 오류",
  failed: "실행 실패",
  cancelled: "취소됨",
}

export function statusLabel(status: RunStatus): string {
  return STATUS_LABEL[status]
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ExportButtons({ run }: { run: EvaluationRun }) {
  const base = exportFileBaseName(run)
  return (
    <div className="export-buttons">
      <button
        type="button"
        className="button-secondary"
        onClick={() => downloadText(`${base}.json`, JSON.stringify(buildRunExport(run), null, 2), "application/json")}
      >
        JSON export
      </button>
      <button
        type="button"
        className="button-secondary"
        onClick={() => downloadText(`${base}.csv`, `﻿${buildRunCsv(run)}`, "text/csv;charset=utf-8")}
      >
        CSV export
      </button>
    </div>
  )
}

type Props = {
  status: PersistenceStatus
  history: RunListItem[]
  currentRunId?: string
  disabled: boolean
  onOpen: (id: string) => void
}

export function RunHistory({ status, history, currentRunId, disabled, onOpen }: Props) {
  return (
    <section className="panel history" aria-labelledby="history-title">
      <div className="panel-heading">
        <h2 id="history-title">최근 runs</h2>
        <span className="muted">
          {status === "disabled" && "저장 안 됨 (IndexedDB 사용 불가)"}
          {status === "loading" && "불러오는 중…"}
          {status === "ready" && `브라우저에 최근 ${history.length}개 저장`}
          {status === "error" && "저장소 오류 — 결과가 저장되지 않을 수 있습니다"}
        </span>
      </div>
      {history.length === 0 ? (
        <p className="muted empty-history">저장된 run이 없습니다.</p>
      ) : (
        <ol className="history-list">
          {history.map((item) => (
            <li key={item.id} className={item.id === currentRunId ? "is-current" : undefined}>
              <button type="button" className="history-item" onClick={() => onOpen(item.id)} disabled={disabled} aria-current={item.id === currentRunId ? "true" : undefined}>
                <span className="history-main">
                  <strong>{item.datasetName}</strong>
                  <span className={`history-status history-status-${item.status}`}>{statusLabel(item.status)}</span>
                </span>
                <span className="history-meta">
                  {formatDateTime(item.createdAt)} · {item.completedCount}/{item.plannedCount} 실행 ·{" "}
                  {item.passCounts.map((p, i) => `${i === 0 ? "A" : "B"} ${p.passCount}/${p.n}`).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
