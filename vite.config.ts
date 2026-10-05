import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

const serverPort = Number(process.env.WORKBENCH_SERVER_PORT ?? 8787)

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 실제 provider 요청은 local Node server를 거친다. browser bundle에 secret을 넣지 않는다.
      "/api": `http://127.0.0.1:${serverPort}`,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
})
