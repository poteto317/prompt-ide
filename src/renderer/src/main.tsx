import './lib/monaco-config'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const rootElement = document.getElementById('root')
// index.html が必ず持つ要素。無ければ(index.html の改変など)どのみち描画できないため、原因の分かる文言で止める
if (rootElement === null) throw new Error('index.html に id="root" の要素がありません')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
