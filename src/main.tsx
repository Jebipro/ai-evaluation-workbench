import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app/App.tsx"
import { tryCreateDefaultStorage } from "./app/persistence/storage.ts"
import "./app/styles.css"

const storage = tryCreateDefaultStorage()

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App storage={storage} />
  </StrictMode>,
)
