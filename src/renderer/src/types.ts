export type Panel = 'explorer' | 'source-control' | 'prompts'

export type Prompt = {
  id: string
  title: string
  content: string
  createdAt: number
}
