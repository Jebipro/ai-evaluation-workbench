// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App.tsx"
import { createIdbStorage } from "./persistence/storage.ts"
import { testRuntime } from "../test/uiRuntime.ts"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

let dbCounter = 0

describe("App persistence / export", () => {
  it("run과 prompt 편집본이 reload 후에도 복원된다", async () => {
    const user = userEvent.setup()
    const dbName = `app-db-${++dbCounter}`
    const first = render(<App runtime={testRuntime()} storage={createIdbStorage(dbName)} />)
    await screen.findByText(/브라우저에 최근 0개 저장/)

    const templateA = within(screen.getByRole("group", { name: "Prompt A" })).getByLabelText(/Prompt template/)
    await user.clear(templateA)
    await user.click(templateA)
    await user.paste("positive, negative, neutral 중 하나만 출력하세요.\n{{input}}")
    await user.click(screen.getByRole("button", { name: "Run Evaluation" }))
    await screen.findByText(/브라우저에 최근 1개 저장/)
    // debounce된 편집본 저장을 기다린다
    await new Promise((resolve) => setTimeout(resolve, 400))
    first.unmount()

    render(<App runtime={testRuntime()} storage={createIdbStorage(dbName)} />)
    await screen.findByText(/브라우저에 최근 1개 저장/)
    expect(await screen.findByRole("heading", { name: "A/B Summary" })).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: "Prompt A summary" })).getByText("9 / 10 (90%)")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Prompt A" })).getByLabelText(/Prompt template/)).toHaveValue(
      "positive, negative, neutral 중 하나만 출력하세요.\n{{input}}",
    )
    const history = screen.getByRole("region", { name: "최근 runs" })
    expect(within(history).getByText("리뷰 감정 분류")).toBeInTheDocument()
    expect(within(history).getByText(/A 9\/10 · B 9\/10/)).toBeInTheDocument()
  })

  it("JSON export는 schemaVersion과 rendered prompt를 포함한 파일을 내려준다", async () => {
    const user = userEvent.setup()
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return "blob:test"
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    render(<App runtime={testRuntime()} />)
    await user.click(screen.getByRole("button", { name: "Run Evaluation" }))
    await user.click(await screen.findByRole("button", { name: "JSON export" }))

    expect(click).toHaveBeenCalledTimes(1)
    const exported = JSON.parse(await blobs[0].text())
    expect(exported.schemaVersion).toBe(1)
    expect(exported.run).toMatchObject({ status: "completed", plannedCount: 20, completedCount: 20 })
    expect(exported.results[0].renderedPrompt).toContain("배송이 빨라서 정말 만족스러워요.")

    await user.click(screen.getByRole("button", { name: "CSV export" }))
    const csv = await blobs[1].text()
    expect(csv).toContain("case_id,case_name,variant_id")
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled())
  })
})
