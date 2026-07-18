export interface ModelOption {
  id: string
  label: string
  maxOutputTokens: number
}

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', maxOutputTokens: 128000 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', maxOutputTokens: 128000 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', maxOutputTokens: 128000 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', maxOutputTokens: 64000 }
] as const satisfies readonly ModelOption[]

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id']

export interface ModelSettings {
  modelId: ModelId
  maxTokens: number
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  modelId: 'claude-haiku-4-5',
  maxTokens: 4096
}
