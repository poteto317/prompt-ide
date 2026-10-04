import { createContext } from 'react'
import type { ApplyActions } from './ApplyButtons'

// MarkdownRenderer の components(pre の差し替え)はモジュールの定数にし、描画ごとに作り直さない
// (作り直すと要素の型が変わり、コードブロックが毎回作り直されてボタンのフォーカスが失われる)。
// 描画ごとに変わる反映の状態は、この context で CodeBlock へ渡す
export const CodeBlockActionsContext = createContext<ApplyActions | null>(null)
