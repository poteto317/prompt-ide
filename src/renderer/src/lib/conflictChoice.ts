import type { ConflictChoice } from '@shared/types'

// 「ブロック <i> を<自分の内容|相手の内容|両方>に」。選択後の読み上げ(ConflictResolver の
// role="status")で末尾に「しました」を付ける。ConflictBlock のボタンの aria-label は表示文言を
// 含める(WCAG 2.5.3)ため、これを使わず「ブロック <i> の<表示文言>」にしている
export const CHOICE_TARGET: Record<ConflictChoice, string> = {
  ours: '自分の内容に',
  theirs: '相手の内容に',
  both: '両方に'
}
