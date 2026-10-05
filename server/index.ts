import { createWorkbenchServer, DEFAULT_UPSTREAM_TIMEOUT_MS } from "./app.ts"
import { DEFAULT_OLLAMA_BASE_URL } from "../src/core/providers/ollama.ts"

// 실행: npm run server  (Node 22.18+ / 24의 type stripping으로 .ts를 바로 실행)
// 환경 변수: WORKBENCH_SERVER_PORT(기본 8787), OLLAMA_BASE_URL(기본 http://127.0.0.1:11434),
//           WORKBENCH_UPSTREAM_TIMEOUT_MS(기본 120000)

const port = Number(process.env.WORKBENCH_SERVER_PORT ?? 8787)
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
const upstreamTimeoutMs = Number(process.env.WORKBENCH_UPSTREAM_TIMEOUT_MS ?? DEFAULT_UPSTREAM_TIMEOUT_MS)

const server = createWorkbenchServer({ ollamaBaseUrl, upstreamTimeoutMs })
server.listen(port, "127.0.0.1", () => {
  console.log(`[workbench-server] http://127.0.0.1:${port} → Ollama ${ollamaBaseUrl}`)
})
