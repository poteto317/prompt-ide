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
