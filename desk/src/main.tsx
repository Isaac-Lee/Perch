import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/chat.css'
import './styles/highlight.css'
import App from './App.tsx'
import { initBackend } from './lib/backend'
import { applyTheme } from './lib/theme'
import { loadTheme } from './lib/uiSettings'
import { installClickRepair } from './lib/strayClick'

applyTheme(loadTheme()) // before first paint

installClickRepair(document)

await initBackend()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
