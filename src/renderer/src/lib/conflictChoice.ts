import type { ConflictChoice } from '@shared/types'

// 「ブロック <i> を<自分の内容|相手の内容|両方>に」。ConflictBlock の aria-label は末尾に「する」、
// 選択後の読み上げ(ConflictResolver の role="status")は「しました」を付ける
export const CHOICE_TARGET: Record<ConflictChoice, string> = {
  ours: '自分の内容に',
  theirs: '相手の内容に',
  both: '両方に'
}
