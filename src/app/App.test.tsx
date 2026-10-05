// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "./App.tsx"
import { GateProvider, testRuntime } from "../test/uiRuntime.ts"

afterEach(cleanup)

async function runAndWait(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Run Evaluation" }))
  await screen.findByRole("heading", { name: "A/B Summary" })
  await waitFor(() => expect(screen.getByRole("button", { name: "Run Evaluation" })).toBeEnabled())
}

function variantCard(slot: "A" | "B") {
  return screen.getByRole("article", { name: `Prompt ${slot} summary` })
}

describe("App", () => {
  it("첫 화면: 목적, Demo 고지, preset이 보인다", () => {
    render(<App runtime={testRuntime()} />)
    expect(screen.getByText("같은 Test Dataset으로 두 Prompt를 실행하고, 결과와 실패 case를 비교합니다.")).toBeInTheDocument()
    expect(screen.getByText(/실제 LLM 응답이 아닌 규칙 기반 시뮬레이션입니다/).closest(".demo-notice")).toHaveTextContent("Demo mode · 실제 LLM 응답이 아닌 규칙 기반 시뮬레이션입니다.")
    expect(screen.getByRole("radio", { name: /Classification/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /Structured JSON/ })).not.toBeChecked()
    expect(screen.getByRole("group", { name: "Prompt A" })).toBeInTheDocument()
    expect(screen.getByText("아직 실행한 evaluation이 없습니다")).toBeInTheDocument()
  })

  it("Run은 core runner를 호출하고 A/B summary를 n과 함께 표시한다", async () => {
    const user = userEvent.setup()
    const runtime = testRuntime()
    render(<App runtime={runtime} />)
    await runAndWait(user)

    expect(runtime.calls).toHaveLength(1)
    const [input] = runtime.calls[0]
    expect(input.variants.map((v) => v.name)).toEqual(["Prompt A", "Prompt B"])
    expect(input.dataset.cases).toHaveLength(10)

    expect(within(variantCard("A")).getByText("5 / 10 (50%)")).toBeInTheDocument()
    expect(within(variantCard("B")).getByText("9 / 10 (90%)")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("정상 완료")
    // simulated provider는 latency를 만들지 않는다
    expect(within(variantCard("A")).getByText("(simulated)")).toBeInTheDocument()
  })

  it("실행 중 progress를 표시하고 중복 Run을 막는다", async () => {
    const user = userEvent.setup()
    const runtime = testRuntime({ demoDelayMs: 40 })
    render(<App runtime={runtime} />)
    await user.click(screen.getByRole("button", { name: "Run Evaluation" }))
    const progressbar = await screen.findByRole("progressbar", { name: "evaluation 진행률" })
    expect(progressbar).toHaveAttribute("aria-valuemax", "20")
    expect(screen.getByRole("button", { name: "실행 중…" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "실행 중…" }))
    expect(screen.getByText(/\d+ \/ 20 완료/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Evaluation" })).toBeEnabled(), { timeout: 3000 })
    expect(runtime.calls).toHaveLength(1)
  })

  it("Cancel은 provider signal까지 abort하고, 완료된 결과를 보존해 표시한다", async () => {
    const user = userEvent.setup()
    const gate = new GateProvider(2)
    render(<App runtime={testRuntime({ provider: () => gate })} />)
    await user.click(screen.getByRole("button", { name: "Run Evaluation" }))
    await screen.findByText("2 / 20 완료")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    const banner = await screen.findByText(/취소됨/)
    expect(banner.closest(".banner")).toHaveTextContent("취소됨 · 2 / 20 완료. 완료된 결과는 보존되었습니다.")
    expect(gate.signals.slice(2).every((signal) => signal.aborted)).toBe(true)
    expect(within(variantCard("A")).getByText("1 / 1 (100%)")).toBeInTheDocument()
    expect(screen.getAllByText("결과 없음").length).toBeGreaterThan(0)
  })

  it("인프라 오류 시뮬레이션: partiallyFailed와 FAIL / ERROR를 구분해 표시한다", async () => {
    const user = userEvent.setup()
    render(<App runtime={testRuntime()} />)
    await user.click(screen.getByRole("checkbox", { name: "인프라 오류 시뮬레이션" }))
    expect(screen.getByText(/평가 점수 조작이 아닙니다/)).toBeInTheDocument()
    await runAndWait(user)

    const banner = screen.getByRole("status")
    expect(banner).toHaveTextContent("일부 실행 오류")
    expect(banner).toHaveTextContent(/실행 오류 \d+건\. 해당 case는 output 없이 0점\(ERROR\)으로 집계되었습니다/)
    const table = screen.getByRole("table")
    expect(within(table).getAllByText("ERROR").length).toBeGreaterThan(0)
    expect(within(table).getAllByText("FAIL").length).toBeGreaterThan(0)
    const errorCount = Number(within(variantCard("A")).getByText("ERROR").closest("dt")?.nextElementSibling?.textContent)
    const errorCountB = Number(within(variantCard("B")).getByText("ERROR").closest("dt")?.nextElementSibling?.textContent)
    expect(errorCount + errorCountB).toBeGreaterThan(0)
  })

  it("case detail에서 rendered prompt, output, reason을 보여준다", async () => {
    const user = userEvent.setup()
    render(<App runtime={testRuntime()} />)
    await runAndWait(user)
    await user.click(screen.getByRole("button", { name: "단순 수령 보고 상세 보기" }))

    const detail = screen.getByRole("region", { name: /Case detail · 단순 수령 보고/ })
    expect(within(detail).getByTestId("rendered-prompt-A").textContent).toBe(
      "다음 리뷰의 감정을 한 단어로만 답하세요.\n\n상품을 오늘 수령했습니다.",
    )
    expect(within(detail).getByTestId("rendered-prompt-B").textContent).toContain("Input:\n상품을 오늘 수령했습니다.")
    expect(within(detail).getByText("mixed")).toBeInTheDocument()
    expect(within(detail).getByText(/expected="neutral", actual="mixed"/)).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("region", { name: /Case detail/ })).not.toBeInTheDocument()
  })

  it("Prompt를 수정하면 결과가 달라진다", async () => {
    const user = userEvent.setup()
    render(<App runtime={testRuntime()} />)
    const templateA = within(screen.getByRole("group", { name: "Prompt A" })).getByLabelText(/Prompt template/)
    await user.clear(templateA)
    await user.click(templateA)
    await user.paste("positive, negative, neutral 중 하나만 출력하세요.\n{{input}}")
    await runAndWait(user)
    expect(within(variantCard("A")).getByText("9 / 10 (90%)")).toBeInTheDocument()
  })

  it("validation 실패 시 오류 목록을 보여주고 run을 시작하지 않는다", async () => {
    const user = userEvent.setup()
    const runtime = testRuntime()
    render(<App runtime={runtime} />)
    const templateB = within(screen.getByRole("group", { name: "Prompt B" })).getByLabelText(/Prompt template/)
    await user.clear(templateB)
    await user.type(templateB, "입력 없이 분류")
    await user.click(screen.getByRole("button", { name: "Run Evaluation" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("실행 전 검증 실패")
    expect(alert).toHaveTextContent("{{input}} placeholder가 없습니다.")
    expect(screen.queryByRole("heading", { name: "A/B Summary" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run Evaluation" })).toBeEnabled()
  })

  it("Structured JSON preset: fenced JSON은 FAIL로 표시된다", async () => {
    const user = userEvent.setup()
    render(<App runtime={testRuntime()} />)
    await user.click(screen.getByRole("radio", { name: /Structured JSON/ }))
    await runAndWait(user)
    expect(within(variantCard("A")).getByText("0 / 10 (0%)")).toBeInTheDocument()
    expect(within(variantCard("B")).getByText("9 / 10 (90%)")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "기본 연락처 (valid JSON) 상세 보기" }))
    expect(screen.getByText("출력이 markdown code fence로 감싸져 있어 strict JSON이 아닙니다.")).toBeInTheDocument()
  })
})
