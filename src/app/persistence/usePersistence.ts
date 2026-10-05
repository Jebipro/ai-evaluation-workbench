import { useCallback, useEffect, useRef, useState } from "react"
import { PRESETS } from "../../core/presets.ts"
import type { EvaluationRun } from "../../core/types.ts"
import type { VariantPair, WorkbenchAction, WorkbenchState } from "../state/workbenchState.ts"
import type { RunListItem, WorkbenchStorage } from "./storage.ts"

export type PersistenceStatus = "disabled" | "loading" | "ready" | "error"

const SAVE_DEBOUNCE_MS = 300

/**
 * workbench 설정 / prompt 편집본 / 최근 run을 IndexedDB와 동기화한다.
 * storage가 없으면(테스트, private mode) 아무것도 하지 않는다.
 */
export function usePersistence(params: {
  storage: Promise<WorkbenchStorage | null> | undefined
  workbench: WorkbenchState
  dispatch: (action: WorkbenchAction) => void
  showRun: (run: EvaluationRun) => void
}) {
  const { storage: storagePromise, workbench, dispatch, showRun } = params
  const storageRef = useRef<WorkbenchStorage | null>(null)
  const [status, setStatus] = useState<PersistenceStatus>(storagePromise ? "loading" : "disabled")
  const [history, setHistory] = useState<RunListItem[]>([])
  const [restored, setRestored] = useState(false)

  const refreshHistory = useCallback(async () => {
    if (storageRef.current) setHistory(await storageRef.current.listRuns())
  }, [])

  // 초기 복원: workspace → preset별 편집본 → 최근 run 목록과 마지막 run
  useEffect(() => {
    if (!storagePromise) return
    let cancelled = false
    void (async () => {
      try {
        const storage = await storagePromise
        if (cancelled) return
        if (!storage) {
          setStatus("disabled")
          return
        }
        storageRef.current = storage
        const workspace = await storage.loadWorkspace()
        const drafts: Record<string, VariantPair> = {}
        for (const preset of PRESETS) {
          const saved = await storage.loadVariants(preset.id)
          if (saved.A && saved.B) drafts[preset.id] = { A: saved.A, B: saved.B }
        }
        const runs = await storage.listRuns()
        const latest = runs[0] ? await storage.getRun(runs[0].id) : undefined
        if (cancelled) return
        dispatch({ type: "restore", state: { ...workspace, drafts } })
        setHistory(runs)
        if (latest) showRun(latest)
        setStatus("ready")
      } catch {
        if (!cancelled) setStatus("error")
      } finally {
        if (!cancelled) setRestored(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storagePromise, dispatch, showRun])

  // 설정 / 편집본 저장 (복원이 끝난 뒤부터)
  const { presetId, variants, providerMode, ollamaModel } = workbench
  useEffect(() => {
    const storage = storageRef.current
    if (!restored || !storage) return
    const timer = setTimeout(() => {
      void storage.saveWorkspace({ presetId, providerMode, ollamaModel }).catch(() => setStatus("error"))
      void storage.saveVariants(presetId, variants).catch(() => setStatus("error"))
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [restored, presetId, variants, providerMode, ollamaModel])

  const saveRun = useCallback(
    async (run: EvaluationRun) => {
      const storage = storageRef.current
      if (!storage) return
      try {
        await storage.saveRun(run)
        await storage.saveDataset(run.datasetSnapshot)
        await refreshHistory()
      } catch {
        setStatus("error")
      }
    },
    [refreshHistory],
  )

  const openRun = useCallback(
    async (id: string) => {
      const run = await storageRef.current?.getRun(id)
      if (run) showRun(run)
    },
    [showRun],
  )

  return { status, history, saveRun, openRun }
}
