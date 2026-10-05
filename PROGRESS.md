# PROGRESS

## 현재 상태
- Phase 1 (Evaluation Core): **완료**
- Phase 2 (Product UI): **완료** — A/B demo evaluation end-to-end, prompt 편집 → 결과 변화, cancel, 인프라 오류 시뮬레이션(partiallyFailed), case detail
- Phase 3 (Persistence / Export / Ollama / Polish): 진행 예정
- tests: 140 passed / typecheck: 통과 / build: 통과 / browser: Demo run 1회 확인 (콘솔 오류 없음)

## 결정 사항 (Decision log)
- **core는 React와 독립** (`src/core/**`). Node type stripping으로 server에서도 그대로 import할 수 있도록 상대 import에 `.ts` 확장자를 쓰고 `erasableSyntaxOnly`를 켰다 (enum / parameter property 금지).
- **결과 상태는 저장하지 않고 파생**: `getCaseOutcome(result)` → `error` 있음 = ERROR, 아니면 `passed` 기준.
- **ERROR case**: `score 0`, `passed false`, `output` 없음, evaluator 미호출. n / pass rate 분모 포함, latency 평균 제외.
- **timeout vs cancel**: Runner가 attempt마다 `AbortController`를 만들고 run signal + timeout을 합쳐 provider에 전달. abort 원인 flag(`runSignal.aborted` / `timedOut`)로 kind를 결정. provider가 signal을 무시해도 `raceWithSignal`로 끊는다.
- **cancel 시 완료 결과 보존**: in-flight / 미시작 case는 CaseResult를 만들지 않는다 (`TaskCancelled` 내부 신호).
- **latency**: Runner가 `performance.now()`로 성공한 마지막 attempt만 측정 (backoff 제외). simulated provider는 `latencyMs` / `usage`를 기록하지 않는다.
- **`ModelRequest.input`**: DemoProvider가 지시문과 입력을 분리하기 위한 metadata. 실제 provider는 사용하지 않고 Ollama body에도 넣지 않는다.
- **DemoProvider 규칙 R0~R5** (`src/core/providers/demo.ts` 주석 표 = 테스트 = README 표). case / variant ID를 보지 않는다.
- **FaultInjectingProvider**: (rendered prompt hash, prompt별 시도 순번)으로 결정. run마다 새 인스턴스를 만들어야 counter가 초기화된다.
- `CaseResult.attempts`를 성공 case에도 저장 (retry 후 성공을 detail에서 보여주기 위함). `CaseResult.raw`에 provider metadata 보존.
- `EvaluationRun.failureMessage`: `failed`일 때 원인 (runner 오류 또는 error kind 분포).
- validation 실패 → `RunValidationError(issues)` throw, run 객체를 만들지 않음 (저장 불가).
- UI state 분리: `workbenchReducer`(setup / 선택 case) + `runReducer`(run 진행 / 마지막 run) + `useEvaluationRun` hook. component는 core의 summarizeRun / compareVariants / getCaseOutcome을 그대로 쓴다.
- 중복 run 방지: hook은 AbortController ref로 동기 확인, reducer는 core `transition`으로 활성 상태에서 start를 거부.
- `Runtime`(runEvaluation, createProviders)을 App prop으로 주입 → UI 테스트는 실제 core runner + DemoProvider(지연 0)로 실행.
- A/B 구분: 색 + "A"/"B" 글자 tag. PASS/FAIL/ERROR는 아이콘 + 텍스트 (ERROR는 점선 테두리).
- 의존성: TypeScript 7.0.2, Vite 8, Vitest 5, React 19, idb 8. 추가 framework 없음.

## Ollama 환경
- 확인 일시: 2026-10-06
- `ollama --version` / `ollama list`: **command not found** (PATH에 없음, `%LOCALAPPDATA%\Programs\Ollama\ollama.exe` 없음)
- `http://127.0.0.1:11434/api/tags`: **연결 불가** (서버 미실행)
- 사용 가능한 모델: 없음
- fixture 출처: **문서 기반 손작성** (`fixtures/ollama-chat-response.json`, `"_source": "handwritten-from-docs; 실제 응답으로 교체 필요"`)
- **사용자 허가 필요**: Ollama 설치, 서버 실행, 모델 다운로드 (예: `ollama pull llama3.2:1b` ≈ 1.3GB, `qwen2.5:1.5b` ≈ 1GB). 자동으로 하지 않음.

## 미완료 / 알려진 이슈
- Phase 3 전체 (persistence, export, Ollama local server, README)
- 동일한 rendered prompt를 가진 task가 둘 이상이면 FaultInjectingProvider의 시도 순번 counter를 공유한다 (최종 결과는 같지만 attempts가 달라질 수 있음)

## 다음에 실행할 명령
- `npm install && npm test && npm run typecheck`

## 다음 첫 작업
- `src/app/persistence/db.ts`에 idb 기반 store(datasets / variants / runs 최근 20개)를 만들고 `useEvaluationRun`의 `onFinished`에서 run을 저장, 앱 시작 시 최근 run 목록을 불러온다. 이어서 JSON export → `server/` Ollama proxy → README.
