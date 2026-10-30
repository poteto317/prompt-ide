// 変更の同期のボタン(コミット欄の主ボタンとステータスバー)の文言。両方で食い違わないよう 1 か所で決める

/** 件数の部分。`↓<behind> ↑<ahead>` の形で、0 の側は出さない */
export function formatSyncCounts(ahead: number, behind: number): string {
  const parts: string[] = []
  if (behind > 0) parts.push(`↓${behind}`)
  if (ahead > 0) parts.push(`↑${ahead}`)
  return parts.join(' ')
}

/** 矢印は読み上げに向かないため、0 の側も含めて件数を言葉で伝える */
export function getSyncChangesAriaLabel(ahead: number, behind: number): string {
  return `変更を同期(プル ${behind} 件、プッシュ ${ahead} 件)`
}
