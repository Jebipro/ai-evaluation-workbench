import { readFileSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkbenchServer, validateRunRequest } from "./app.ts"
import { ProxyProvider } from "../src/core/providers/proxy.ts"

const fixture = JSON.parse(readFileSync(new URL("../fixtures/ollama-chat-response.json", import.meta.url), "utf8"))

type UpstreamHandler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void

const servers: http.Server[] = []

async function listen(server: http.Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** 가짜 Ollama. 받은 요청 body와 연결 종료 여부를 기록한다 */
async function fakeOllama(handler: UpstreamHandler) {
  const received: unknown[] = []
  const closed: boolean[] = []
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined
    received.push(body)
    const index = closed.push(false) - 1
    res.on("close", () => {
      if (!res.writableFinished) closed[index] = true
    })
    handler(req, res, body)
  })
  return { url: await listen(server), received, closed }
}

async function startWorkbench(ollamaBaseUrl: string, upstreamTimeoutMs = 5000) {
  return listen(createWorkbenchServer({ ollamaBaseUrl, upstreamTimeoutMs }))
}

async function postRun(base: string, body: unknown, signal?: AbortSignal) {
  return fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

const validBody = { model: "llama3.2", prompt: "분류: 최고예요", systemPrompt: "분류기", temperature: 0, seed: 42 }

describe("workbench server /api/run", () => {
  it("Ollama /api/chat(stream false)를 호출하고 output / usage를 정규화한다", async () => {
    const upstream = await fakeOllama((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(fixture))
    })
    const base = await startWorkbench(upstream.url)
    const response = await postRun(base, validBody)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toMatchObject({
      output: "positive",
      usage: { inputTokens: fixture.prompt_eval_count, outputTokens: fixture.eval_count },
      raw: { total_duration: fixture.total_duration },
    })
    expect(upstream.received[0]).toEqual({
      model: "llama3.2",
      stream: false,
      messages: [
        { role: "system", content: "분류기" },
        { role: "user", content: "분류: 최고예요" },
      ],
      options: { temperature: 0, seed: 42 },
    })
  })

  it("ProxyProvider(브라우저 측)와 end-to-end로 연결된다", async () => {
    const upstream = await fakeOllama((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(fixture))
    })
    const base = await startWorkbench(upstream.url)
    const provider = new ProxyProvider({ serverUrl: base })
    const response = await provider.run({ ...validBody, input: "최고예요" }, { signal: new AbortController().signal })
    expect(response.output).toBe("positive")
    expect(response.usage).toEqual({ inputTokens: 26, outputTokens: 298 })
  })

  it("잘못된 request는 400 / http_4xx", async () => {
    const base = await startWorkbench("http://127.0.0.1:9")
    const response = await postRun(base, { model: "", prompt: 1, temperature: 5 })
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.kind).toBe("http_4xx")
    expect(json.error.message).toContain("model")
    expect(json.error.message).toContain("temperature")
  })

  it("upstream 오류를 ErrorKind로 정규화한다 (5xx / 429 / 404 / invalid)", async () => {
    const cases: [number, unknown, number, string][] = [
      [500, { error: "boom" }, 502, "http_5xx"],
      [429, { error: "busy" }, 429, "http_429"],
      [404, { error: "model 'x' not found" }, 502, "http_4xx"],
      [200, { done: true }, 502, "invalid_response"],
    ]
    for (const [upstreamStatus, upstreamBody, expectedStatus, kind] of cases) {
      const upstream = await fakeOllama((_req, res) => {
        res.writeHead(upstreamStatus, { "content-type": "application/json" })
        res.end(JSON.stringify(upstreamBody))
      })
      const base = await startWorkbench(upstream.url)
      const response = await postRun(base, validBody)
      expect(response.status).toBe(expectedStatus)
      const json = await response.json()
      expect(json.error.kind).toBe(kind)
      if (upstreamStatus !== 200) expect(json.error.httpStatus).toBe(upstreamStatus)
    }
  })

  it("Ollama에 연결할 수 없으면 network", async () => {
    const closedServer = http.createServer()
    const url = await listen(closedServer)
    await new Promise<void>((resolve) => closedServer.close(() => resolve()))
    const base = await startWorkbench(url)
    const response = await postRun(base, validBody)
    expect(response.status).toBe(502)
    expect((await response.json()).error.kind).toBe("network")
  })

  it("upstream timeout은 504 / timeout이고 upstream 요청을 abort한다", async () => {
    const upstream = await fakeOllama(() => {
      /* 응답하지 않음 */
    })
    const base = await startWorkbench(upstream.url, 50)
    const response = await postRun(base, validBody)
    expect(response.status).toBe(504)
    expect((await response.json()).error.kind).toBe("timeout")
    await waitFor(() => upstream.closed[0] === true)
  })

  it("client가 요청을 abort하면 upstream Ollama 요청도 abort된다", async () => {
    const upstream = await fakeOllama(() => {
      /* 응답하지 않음 */
    })
    const base = await startWorkbench(upstream.url)
    const controller = new AbortController()
    const pending = postRun(base, validBody, controller.signal)
    await waitFor(() => upstream.received.length === 1)
    expect(upstream.closed[0]).toBe(false)
    controller.abort()
    await expect(pending).rejects.toThrow()
    await waitFor(() => upstream.closed[0] === true)
  })

  it("health: Ollama 연결 여부와 모델 목록", async () => {
    const upstream = await fakeOllama((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ models: [{ name: "llama3.2:1b" }] }))
    })
    const base = await startWorkbench(upstream.url)
    const json = await (await fetch(`${base}/api/health`)).json()
    expect(json.ollama).toMatchObject({ reachable: true, models: ["llama3.2:1b"] })

    const offline = await startWorkbench("http://127.0.0.1:9")
    expect((await (await fetch(`${offline}/api/health`)).json()).ollama.reachable).toBe(false)
  })
})

describe("validateRunRequest", () => {
  it("정상 body는 trim된 model과 함께 통과", () => {
    expect(validateRunRequest({ model: " m ", prompt: "p" })).toEqual({ model: "m", prompt: "p" })
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timeout")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
