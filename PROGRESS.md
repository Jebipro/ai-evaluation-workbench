# PROGRESS

## 현재 상태
- **MVP 완료 (닫음).** Phase 1 / 2 / 3 모두 완료, 실제 Ollama end-to-end 검증 완료.
- tests: **163 passed** (15 files) / typecheck: 통과 / build: 통과
- browser: Demo(실행, prompt 수정, 인프라 오류 시뮬레이션, cancel, export, reload 복원)와 실제 Ollama(두 preset 실행, 재실행 결정성 비교, cancel) 확인. 콘솔 / server 오류 없음
- screenshot (`docs/images/`): `ollama-ab-summary.jpg`(실제 Ollama Summary), `ollama-json-fence-detail.jpg`(실측 fence FAIL), `case-detail-error.jpg`(Demo 인프라 오류 ERROR). Phase 2 시점의 `ab-summary.jpg`는 삭제

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
- **server**: `node:http`만 사용, 127.0.0.1 bind. 오류 body `{ error: { kind, message, httpStatus? } }` — `httpStatus`는 upstream(Ollama) status만.
- server upstream timeout(기본 120초)은 Runner timeout(30초)보다 길게 두어, 일반적으로 timeout 판정은 Runner가 한다.
- **실측 결과에 맞춰 preset / prompt를 고치지 않았다.** 작은 모델이 fence를 붙이는 것은 strict JSON 규칙이 잡아내야 할 실제 현상이다.
- 의존성: TypeScript 7.0.2, Vite 8, Vitest 5, React 19, idb 8 / dev: Testing Library, jsdom, fake-indexeddb. 추가 framework 없음.

## Ollama 환경
- 2026-10-06 Phase 1 / 3 확인 시 미설치 → 사용자 허가 후 설치
- 설치: `winget install --id Ollama.Ollama --exact` (공식 게시자 Ollama, 설치 관리자 hash 확인됨) → `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, 설치 후 서버 자동 기동
- `ollama --version`: 0.35.1 / `ollama list`: `qwen2.5:1.5b` (986 MB). 1~2B급 중 지시 준수와 JSON 출력이 무난하고 다운로드가 작아서 선택
- `ollama ps`: 100% GPU, context 4096
- 기존 셸의 PATH에는 `ollama`가 아직 없을 수 있음 (새 터미널에서 반영). 전체 경로로 실행 가능
- fixture: **실측** (`fixtures/ollama-chat-response.json`, `_source: "measured: ..."`, 실제로 보낸 `_request` 포함). 응답 필드: `message.content`, `prompt_eval_count`, `prompt_eval_cached_count`(문서 기반 fixture에 없던 필드, raw metadata에 보존), `eval_count`, `*_duration`
- 실측 결과 (temperature 0, seed 42, concurrency 3, browser → server → Ollama):
  - Classification: A 0/10, B 6/10 · latency 161 / 129 ms · token in/out 59/4, 69/2
  - Structured JSON: A 0/10, B 0/10 (B는 10개 모두 ```json fence) · latency 845 / 874 ms
  - 재실행 결정성: Classification 20/20 동일, Structured JSON 17/20 동일. 직접 순차 5회 요청에서도 비결정 출력이 나와 concurrency만의 원인으로 단정하지 않음
  - Cancel: "취소됨 · 4 / 20 완료" 확인

## 미완료 / 알려진 이슈 (MVP 범위 밖으로 남김)
- Dataset / test case 편집 UI, import 없음 (preset만)
- repeated trials 없음 — 실측에서 temperature 0 + seed로도 JSON 3/20 출력이 바뀌었으므로 다음 확장 1순위
- 동일한 rendered prompt를 가진 task가 여러 개면 FaultInjectingProvider의 시도 순번 counter 공유
- 사용자 regex의 ReDoS 방어 없음
- screenshot은 browser pane 제약으로 약 800px 폭 (단일 컬럼 레이아웃 화면)
- 1024~1100px에서는 단일 컬럼 레이아웃 (breakpoint 1100px)
- 실제 provider 검증은 모델 1개 / 환경 1곳

## 다음에 실행할 명령
```bash
npm install && npm test && npm run typecheck && npm run build
npm run dev            # Demo mode
npm run server         # Ollama 사용 시 (별도 터미널, Ollama 실행 + 모델 필요)
```

## 다음 첫 작업
- MVP는 여기서 닫았습니다. 이어간다면: repeated trials(같은 run N회 + case별 output 일치율) → dataset 편집 / import → lenient JSON 모드를 strict 결과와 나란히 표시.
