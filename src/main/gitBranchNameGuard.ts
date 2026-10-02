import type { SimpleGit } from 'simple-git'
import { getBranchNameRuleViolation } from '@shared/branchName'

// ブランチ名が不正なときのエラー。形式違反(アプリ独自の規則・git の check-ref-format)は
// 原則この同じ文言にし、呼び出し元(エラーバナー・ダイアログ)が違反の種類を区別する必要が無いように
// する。例外は '-' 始まりで、直し方が明確なため assertValidNewBranchName が専用の文言を返す
export function invalidBranchNameError(branchName: string): Error {
  return new Error(`ブランチ名として使用できない名前です: ${branchName}`)
}

// 新しいブランチ名(ブランチの作成・リポジトリの初期化の最初のブランチ)として、名前の形式が正しいかを検証する。
// branchName は IPC 境界から届く任意の文字列のため、次の順で検証する(前の検証に失敗したら後の git 呼び出しには
// 進まない)。gitService の createBranch と gitRemoteSetupService の initRepository が使う(パターン 55・88):
// 1. アプリ独自の規則(@shared/branchName)。'-' 始まりは check-ref-format 自体にもオプションとして
//    解釈されるため、git に渡す前に弾く(パターン 21)。'@' のみは `git checkout @` が HEAD と解釈され、
//    作成後に切り替えられない
// 2. git 本体の規則(`..`、空白、`~^:?*[\`、末尾の .lock、HEAD 等)は check-ref-format --branch に委ねる。
//    --branch は '@{-1}'(直前のブランチ)を実在のブランチ名へ展開して成功扱いにするため、出力(正規化後の名前)が
//    入力と一致することも確認する(パターン 25)。reject(不正な名前・git が起動できない)も拒否する(パターン 74)。
//    リポジトリの外でも動く(実機 git 2.50.1 で確認)
export async function assertValidNewBranchName(git: SimpleGit, branchName: string): Promise<void> {
  const violation = getBranchNameRuleViolation(branchName)
  if (violation === 'leading-dash') {
    throw new Error(`\`-\` で始まるブランチ名は使用できません: ${branchName}`)
  }
  if (violation !== null) throw invalidBranchNameError(branchName)
  let normalized: string
  try {
    normalized = (await git.raw(['check-ref-format', '--branch', branchName])).trim()
  } catch {
    throw invalidBranchNameError(branchName)
  }
  if (normalized !== branchName) throw invalidBranchNameError(branchName)
}
