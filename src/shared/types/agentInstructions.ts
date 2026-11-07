/** 指示ファイルの作成(agentInstructions:create)の失敗の理由。画面の文言は renderer が理由から選ぶ(L-017)。
 *  folderChanged は「renderer が作ろうとしたフォルダと、main の許可フォルダが違う(フォルダの切り替えの途中)」で、画面には出さない */
export type AgentInstructionCreateFailureReason = 'exists' | 'outside' | 'failed' | 'folderChanged'

/** 画面に文言を出す失敗の理由(folderChanged は操作を取りやめただけなので出さない) */
export type AgentInstructionCreateShownFailureReason = Exclude<
  AgentInstructionCreateFailureReason,
  'folderChanged'
>

/** agentInstructions:create の結果。ok: true は「新しく作った」ことだけを意味する */
export type AgentInstructionCreateResult =
  | { ok: true }
  | { ok: false; reason: AgentInstructionCreateFailureReason }

/** 全体の指示ファイルの場所を決められない理由(環境変数) */
export type GlobalAgentInstructionUnavailableReason = 'envNotAbsolute' | 'envOutsideHome'

/** agentInstructions:getGlobalStatus の結果。絶対パス(filePath)は exists のときだけ返す(開くためのノードに使う。画面には出さない) */
export type GlobalAgentInstructionStatus =
  | { kind: 'exists'; filePath: string; displayPath: string }
  | { kind: 'missing'; displayPath: string }
  | { kind: 'linkOutsideHome'; displayPath: string }
  | { kind: 'failed'; displayPath: string }
  | { kind: 'unavailable'; reason: GlobalAgentInstructionUnavailableReason }

/** agentInstructions:createGlobal の失敗の理由 */
export type GlobalAgentInstructionCreateFailureReason =
  | 'exists'
  | 'outside'
  | 'failed'
  | 'unavailable'

/** agentInstructions:createGlobal の結果。ok: true は「新しく作った」ことだけを意味する */
export type GlobalAgentInstructionCreateResult =
  | { ok: true }
  | { ok: false; reason: GlobalAgentInstructionCreateFailureReason }
