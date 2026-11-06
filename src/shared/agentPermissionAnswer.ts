// 許可の確認への帯からの答え(設計書 2026-11-06「IPC」)の、選択肢の番号の型と検証。main の受け口(1〜9 の整数であることの確かめ)と
// renderer の読み取り(10 以上の選択肢の画面は読み取らない)が同じ上限を使う

/** 選択肢の番号の上限。copilot は 10 以上の選択肢では 1 桁目の後に複数桁の番号を 500ms 待つため、即決するのは 9 まで */
export const AGENT_PERMISSION_OPTION_NUMBER_MAX = 9

export type AgentPermissionOptionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** 1〜AGENT_PERMISSION_OPTION_NUMBER_MAX の整数か(小数・NaN・Infinity・文字列の数字は偽。L-019) */
export function isAgentPermissionOptionNumber(
  value: unknown
): value is AgentPermissionOptionNumber {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= AGENT_PERMISSION_OPTION_NUMBER_MAX
  )
}
