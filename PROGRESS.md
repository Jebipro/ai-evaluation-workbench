# PROGRESS

## 현재 상태
- Phase 1 (Evaluation Core): **완료**
- Phase 2 (Product UI): **완료**
- Phase 3: **완료 (실제 Ollama 실측 run 제외)**
  - Persistence (IndexedDB, 최근 20 runs, prompt 편집본, workspace) ✅
  - Export (JSON schemaVersion 1, CSV) ✅
  - Ollama provider: local Node server + ProxyProvider 구현 · 가짜 upstream으로 테스트 ✅ / 실제 Ollama 연결 ❌ (미설치)
  - 통계적 정직함 (n 표시, caveat 문구, README limitations) ✅
  - responsive / accessibility (1440 · 1024 · 좁은 폭 overflow 없음, label, focus-visible, table semantics, 아이콘+텍스트 상태, reduced motion) ✅
  - README ✅ / browser verification ✅ / screenshot 2장 (`docs/images/`) ✅
- tests: **162 passed** (15 files) / typecheck: 통과 / build: 통과

## 결정 사항 (Decision log)
- **core는 React와 독립** (`src/core/**`). Node type stripping으로 server에서도 그대로 import할 수 있도록 상대 import에 `.ts` 확장자를 쓰고 `erasableSyntaxOnly`를 켰다 (enum / parameter property 금지).
- **결과 상태는 저장하지 않고 파생**: `getCaseOutcome(result)` → `error` 있음 = ERROR, 아니면 `passed` 기준.
- **ERROR case**: `score 0`, `passed false`, `output` 없음, evaluator 미호출. n / pass rate 분모 포함, latency 평균 제외.
- **timeout vs cancel**: Runner가 attempt마다 `AbortController`를 만들고 run signal + timeout을 합쳐 provider에 전달. abort 원인 flag로 kind 결정. provider가 signal을 무시해도 `raceWithSignal`로 끊는다.
- **cancel 시 완료 결과 보존**: in-flight / 미시작 case는 CaseResult를 만들지 않는다.
- **latency**: Runner가 `performance.now()`로 성공한 마지막 attempt만 측정 (backoff 제외). simulated provider는 `latencyMs` / `usage`를 기록하지 않는다.
- **`ModelRequest.input`**: DemoProvider 전용 metadata. 실제 provider / server로 보내지 않는다.
- **DemoProvider 규칙 R0~R5**: `demo.ts` 주석 표 = `demo.test.ts` = README 표.
- **FaultInjectingProvider**: (rendered prompt hash, prompt별 시도 순번)으로 결정. UI는 run마다 새 인스턴스 생성.
- validation 실패 → `RunValidationError(issues)` throw, run 객체를 만들지 않음 (저장 불가).
- UI state 분리: `workbenchReducer`(setup, preset별 drafts) + `runReducer`(run 진행) + `useEvaluationRun` hook + `usePersistence` hook. component는 core 집계 함수를 그대로 사용.
- `Runtime`(runEvaluation, createProviders)와 `storage`를 App prop으로 주입 → UI 테스트는 실제 core runner + DemoProvider(지연 0) + fake-indexeddb.
- Export / CSV는 core의 순수 함수 (`src/core/export.ts`).
- **server**: `node:http`만 사용, 127.0.0.1 bind. 오류 body `{ error: { kind, message, httpStatus? } }` — `httpStatus`는 upstream(Ollama) status만. ProxyProvider는 server가 준 kind를 우선한다 (browser verification에서 network 오류에 local 502가 붙던 버그를 수정).
- server upstream timeout(기본 120초)은 Runner timeout(30초)보다 길게 두어, 일반적으로 timeout 판정은 Runner가 한다.
- 의존성: TypeScript 7.0.2, Vite 8, Vitest 5, React 19, idb 8 / dev: Testing Library, jsdom, fake-indexeddb. 추가 framework 없음.

## Ollama 환경
- 확인: 2026-10-06 Phase 1 시작 시, Phase 3에서 재확인 — 결과 동일
- `ollama --version` / `ollama list`: **command not found** (PATH 없음, `%LOCALAPPDATA%\Programs\Ollama`, `C:\Program Files\Ollama` 모두 없음)
- `http://127.0.0.1:11434/api/tags`: **연결 불가**
- 사용 가능한 모델: 없음
- fixture 출처: **문서 기반 손작성** (`fixtures/ollama-chat-response.json`, `"_source": "handwritten-from-docs; 실제 응답으로 교체 필요"`)
- browser에서 Ollama mode run 시: server health "Ollama에 연결할 수 없습니다", run은 `failed` ("모든 실행이 실행 오류로 끝났습니다 (network 20건)") — 정상적인 오류 경로 확인
- **사용자 허가 필요**: Ollama 설치, 서버 실행, 모델 다운로드 (예: `ollama pull llama3.2:1b` ≈ 1.3GB 또는 `qwen2.5:1.5b` ≈ 1GB)

## 미완료 / 알려진 이슈
- 실제 Ollama 응답으로 fixture 교체 및 실측 run 미실시 (위 허가 필요)
- Dataset / test case 편집 UI, import 없음 (preset만)
- 동일한 rendered prompt를 가진 task가 여러 개면 FaultInjectingProvider의 시도 순번 counter 공유
- 사용자 regex의 ReDoS 방어 없음 (README limitations)
- screenshot은 browser pane 제약으로 800px 폭 JPEG. `ab-summary.jpg`는 Phase 2 시점 화면이라 상단 export 바 / 최근 runs 패널이 없음
- 1024~1100px에서는 단일 컬럼 레이아웃 (breakpoint 1100px)

## 다음에 실행할 명령
```bash
npm install && npm test && npm run typecheck && npm run build
npm run dev            # Demo mode
npm run server         # Ollama 사용 시 (별도 터미널)
```

## 다음 첫 작업
1. (사용자 허가 후) Ollama 설치 + 작은 모델 pull → `curl -s http://127.0.0.1:11434/api/chat -d '{"model":"llama3.2:1b","messages":[{"role":"user","content":"positive, negative, neutral 중 하나만 출력: 최고예요"}],"stream":false}' > fixtures/ollama-chat-response.json` 로 fixture를 실측 응답으로 교체하고 contract test 재실행 → UI에서 Ollama mode로 두 preset 실행, README에 실측 결과 / screenshot 추가
2. dataset 편집 UI (case 추가 / evaluator 선택) + JSON dataset import
3. repeated trials (같은 run N회) 와 variance 표시
