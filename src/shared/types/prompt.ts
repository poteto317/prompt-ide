export type Prompt = {
  id: string
  title: string
  content: string
  createdAt: number
  /** ピン留め（お気に入り）。未指定は未ピン扱い。 */
  pinned?: boolean
}
