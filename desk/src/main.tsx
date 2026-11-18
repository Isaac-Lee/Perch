import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/chat.css'
import './styles/highlight.css'
import App from './App.tsx'
import { initBackend } from './lib/backend'

await initBackend()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
