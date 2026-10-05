import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { Dataset, EvaluationRun, PromptVariant, RunStatus } from "../../core/types.ts"
import type { ProviderMode, VariantSlot } from "../state/workbenchState.ts"

// IndexedDB persistence. API key나 secret은 저장하지 않는다 (Ollama는 key 불필요).
//
// stores
// - datasets: 실행에 사용한 dataset (id 기준 upsert)
// - variants: preset별 Prompt A / B 편집본 (key = `${presetId}:${slot}`)
// - runs:     최근 evaluation run (snapshot 포함). 최근 MAX_STORED_RUNS개만 유지. cancelled / partiallyFailed도 저장
// - meta:     마지막 workspace 설정

export const DB_NAME = "ai-evaluation-workbench"
export const DB_VERSION = 1
export const MAX_STORED_RUNS = 20

export type StoredVariant = { key: string; presetId: string; slot: VariantSlot; variant: PromptVariant }

export type Workspace = {
  presetId: string
  providerMode: ProviderMode
  ollamaModel: string
}

export type RunListItem = {
  id: string
  createdAt: string
  status: RunStatus
  datasetName: string
  plannedCount: number
  completedCount: number
  passCounts: { variantName: string; passCount: number; n: number }[]
}

interface WorkbenchDB extends DBSchema {
  datasets: { key: string; value: Dataset }
  variants: { key: string; value: StoredVariant; indexes: { byPreset: string } }
  runs: { key: string; value: EvaluationRun; indexes: { byCreatedAt: string } }
  meta: { key: string; value: { key: string; value: unknown } }
}

export interface WorkbenchStorage {
  saveRun(run: EvaluationRun): Promise<void>
  listRuns(): Promise<RunListItem[]>
  getRun(id: string): Promise<EvaluationRun | undefined>
  deleteRun(id: string): Promise<void>
  saveDataset(dataset: Dataset): Promise<void>
  saveVariants(presetId: string, variants: Record<VariantSlot, PromptVariant>): Promise<void>
  loadVariants(presetId: string): Promise<Partial<Record<VariantSlot, PromptVariant>>>
  saveWorkspace(workspace: Workspace): Promise<void>
  loadWorkspace(): Promise<Workspace | undefined>
}

export function toRunListItem(run: EvaluationRun): RunListItem {
  return {
    id: run.id,
    createdAt: run.createdAt,
    status: run.status,
    datasetName: run.datasetSnapshot.name,
    plannedCount: run.plannedCount,
    completedCount: run.summary.completedCount,
    passCounts: run.summary.variants.map((v) => ({ variantName: v.variantName, passCount: v.passCount, n: v.n })),
  }
}

export async function createIdbStorage(dbName: string = DB_NAME): Promise<WorkbenchStorage> {
  const db: IDBPDatabase<WorkbenchDB> = await openDB<WorkbenchDB>(dbName, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore("datasets", { keyPath: "id" })
      database.createObjectStore("variants", { keyPath: "key" }).createIndex("byPreset", "presetId")
      database.createObjectStore("runs", { keyPath: "id" }).createIndex("byCreatedAt", "createdAt")
      database.createObjectStore("meta", { keyPath: "key" })
    },
  })

  return {
    async saveRun(run) {
      const tx = db.transaction("runs", "readwrite")
      await tx.store.put(run)
      // 최근 MAX_STORED_RUNS개만 유지 (오래된 것부터 삭제)
      const keys = await tx.store.index("byCreatedAt").getAllKeys()
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED_RUNS))) await tx.store.delete(key)
      await tx.done
    },
    async listRuns() {
      const runs = await db.getAllFromIndex("runs", "byCreatedAt")
      return runs.reverse().map(toRunListItem)
    },
    getRun: (id) => db.get("runs", id),
    deleteRun: (id) => db.delete("runs", id),
    async saveDataset(dataset) {
      await db.put("datasets", structuredClone(dataset))
    },
    async saveVariants(presetId, variants) {
      const tx = db.transaction("variants", "readwrite")
      for (const slot of ["A", "B"] as const) {
        await tx.store.put({ key: `${presetId}:${slot}`, presetId, slot, variant: structuredClone(variants[slot]) })
      }
      await tx.done
    },
    async loadVariants(presetId) {
      const stored = await db.getAllFromIndex("variants", "byPreset", presetId)
      return Object.fromEntries(stored.map((s) => [s.slot, s.variant]))
    },
    async saveWorkspace(workspace) {
      await db.put("meta", { key: "workspace", value: workspace })
    },
    async loadWorkspace() {
      const record = await db.get("meta", "workspace")
      return record?.value as Workspace | undefined
    },
  }
}

/** IndexedDB를 쓸 수 없는 환경(private mode, 테스트 등)에서는 null → persistence 없이 동작 */
export async function tryCreateDefaultStorage(): Promise<WorkbenchStorage | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return await createIdbStorage()
  } catch {
    return null
  }
}
