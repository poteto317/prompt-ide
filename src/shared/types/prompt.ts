export type Prompt = {
  id: string
  title: string
  content: string
  createdAt: number
  /** ピン留め（お気に入り）。未指定は未ピン扱い。 */
  pinned?: boolean
  /** タグ。未指定はタグなし扱い。 */
  tags?: string[]
}

export const PROMPT_EXPORT_KIND = 'prompt-ide/prompts' as const

/** エクスポート用のエンベロープ。`kind` でファイルの素性を判定する。 */
export type PromptExport = {
  kind: typeof PROMPT_EXPORT_KIND
  version: 1
  exportedAt: number
  prompts: Prompt[]
}
