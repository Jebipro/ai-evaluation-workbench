import { useState } from "react"

type Health =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "server-down"; message: string }
  | { state: "ollama-down"; baseUrl: string; message?: string }
  | { state: "ok"; baseUrl: string; models: string[] }

/** local server(/api/health)를 통해 Ollama 연결 여부와 설치된 모델을 확인한다. */
export function OllamaStatus({ onPickModel }: { onPickModel: (model: string) => void }) {
  const [health, setHealth] = useState<Health>({ state: "idle" })

  async function check() {
    setHealth({ state: "checking" })
    try {
      const response = await fetch("/api/health", { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = (await response.json()) as {
        ollama?: { baseUrl: string; reachable: boolean; models?: string[]; error?: string }
      }
      const ollama = json.ollama
      if (!ollama) throw new Error("예상하지 못한 응답")
      setHealth(
        ollama.reachable
          ? { state: "ok", baseUrl: ollama.baseUrl, models: ollama.models ?? [] }
          : { state: "ollama-down", baseUrl: ollama.baseUrl, message: ollama.error },
      )
    } catch (error) {
      setHealth({ state: "server-down", message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="health" aria-live="polite">
      <button type="button" className="button-small" onClick={() => void check()} disabled={health.state === "checking"}>
        {health.state === "checking" ? "확인 중…" : "서버 / Ollama 연결 확인"}
      </button>{" "}
      {health.state === "server-down" && (
        <span>
          local server에 연결할 수 없습니다 ({health.message}). <code>npm run server</code>를 실행하세요.
        </span>
      )}
      {health.state === "ollama-down" && (
        <span>
          server는 동작하지만 Ollama({health.baseUrl})에 연결할 수 없습니다{health.message ? ` (${health.message})` : ""}.
        </span>
      )}
      {health.state === "ok" &&
        (health.models.length === 0 ? (
          <span>Ollama 연결됨 · 설치된 모델이 없습니다 (모델 다운로드는 직접 실행하세요).</span>
        ) : (
          <span>
            Ollama 연결됨 · 모델:{" "}
            {health.models.map((model) => (
              <button key={model} type="button" className="button-link" onClick={() => onPickModel(model)}>
                {model}
              </button>
            ))}
          </span>
        ))}
    </div>
  )
}
