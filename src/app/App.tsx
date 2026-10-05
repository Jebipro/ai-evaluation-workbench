import { useCallback, useMemo, useReducer } from "react"
import { CaseDetail } from "./components/CaseDetail.tsx"
import { CaseTable } from "./components/CaseTable.tsx"
import { ExportButtons, RunHistory } from "./components/RunHistory.tsx"
import { RunControls } from "./components/RunControls.tsx"
import { SetupPanel } from "./components/SetupPanel.tsx"
import { StatusBanner, ValidationErrors } from "./components/StatusBanner.tsx"
import { SummaryPanel } from "./components/SummaryPanel.tsx"
import type { WorkbenchStorage } from "./persistence/storage.ts"
import { usePersistence } from "./persistence/usePersistence.ts"
import { buildRunInput, defaultRuntime, type Runtime } from "./runtime.ts"
import { useEvaluationRun } from "./state/useEvaluationRun.ts"
import { createInitialWorkbenchState, workbenchReducer } from "./state/workbenchState.ts"
import { buildResultsView, formatDateTime } from "./view.ts"

export type AppProps = {
  runtime?: Runtime
  /** 없으면 persistence 없이 동작 (테스트 기본값) */
  storage?: Promise<WorkbenchStorage | null>
}

export function App({ runtime = defaultRuntime, storage }: AppProps) {
  const [workbench, dispatch] = useReducer(workbenchReducer, undefined, () => createInitialWorkbenchState())
  const { state: runState, start, cancel, showRun, isActive } = useEvaluationRun({
    runtime,
    onFinished: (run) => void persistence.saveRun(run),
  })
  const persistence = usePersistence({ storage, workbench, dispatch, showRun })

  const view = useMemo(() => buildResultsView(runState), [runState])
  const demoMode = workbench.providerMode === "demo" || (view?.providers.some((p) => p.simulated) ?? false)
  const finishedRun = !isActive ? runState.run : undefined

  const handleRun = useCallback(() => {
    const providers = runtime.createProviders({
      faultSimulation: workbench.faultSimulation,
      ollamaModel: workbench.ollamaModel,
    })
    dispatch({ type: "closeCase" })
    void start(buildRunInput(workbench), providers)
  }, [runtime, start, workbench])

  const closeCase = useCallback(() => dispatch({ type: "closeCase" }), [])
  const openCase = useCallback((caseId: string) => dispatch({ type: "openCase", caseId }), [])

  return (
    <div className="app">
      <a className="skip-link" href="#results">
        결과로 건너뛰기
      </a>
      <header className="app-header">
        <div className="app-title">
          <h1>AI Evaluation Workbench</h1>
          <p className="tagline">같은 Test Dataset으로 두 Prompt를 실행하고, 결과와 실패 case를 비교합니다.</p>
        </div>
      </header>

      {demoMode && (
        <div className="demo-notice" role="note">
          <strong>Demo mode</strong> · 실제 LLM 응답이 아닌 규칙 기반 시뮬레이션입니다.
        </div>
      )}

      <main className="layout">
        <div className="column-setup">
          <SetupPanel state={workbench} dispatch={dispatch} disabled={isActive} />
          <div className="panel run-panel">
            <RunControls state={runState} isActive={isActive} onRun={handleRun} onCancel={cancel} />
            <ValidationErrors issues={runState.validationIssues} />
            <StatusBanner state={runState} />
          </div>
          <RunHistory
            status={persistence.status}
            history={persistence.history}
            currentRunId={finishedRun?.id}
            disabled={isActive}
            onOpen={(id) => void persistence.openRun(id)}
          />
        </div>

        <div className="column-results" id="results" tabIndex={-1}>
          {view ? (
            <>
              {finishedRun && (
                <div className="panel run-meta">
                  <span>
                    표시 중인 run: <strong>{finishedRun.datasetSnapshot.name}</strong> · {formatDateTime(finishedRun.createdAt)}
                    {finishedRun.providerSnapshot.length > 0 && (
                      <span className="muted">
                        {" "}
                        · {finishedRun.providerSnapshot.map((p) => `${p.kind}${p.model ? ` / ${p.model}` : ""}`).join(", ")}
                      </span>
                    )}
                  </span>
                  <ExportButtons run={finishedRun} />
                </div>
              )}
              <SummaryPanel view={view} />
              <CaseTable view={view} selectedCaseId={workbench.selectedCaseId} onOpen={openCase} />
              {workbench.selectedCaseId && <CaseDetail view={view} caseId={workbench.selectedCaseId} onClose={closeCase} />}
            </>
          ) : (
            <section className="panel empty-state">
              <h2>아직 실행한 evaluation이 없습니다</h2>
              <p>
                왼쪽에서 Test Dataset을 고르고 Prompt A / B를 확인한 뒤 <strong>Run Evaluation</strong>을 누르세요. 각 case가
                두 prompt로 실행되고, deterministic evaluator가 PASS / FAIL을 판정합니다.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
