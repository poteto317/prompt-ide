import { lstat, readdir, rm } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

// 記録の一時ディレクトリの名前と起動時の掃除(設計書 2026-10-15「記録の一時ディレクトリの名前と起動時の掃除」)。名前に main の
// 起動ごとの ID(<pid>-<16 進 8 桁>。保護の ref と同じ instanceId)を入れ、起動のときに、名前の形が一致し、自分の instanceId でなく、
// pid のプロセスが無く、自分のもの(lstat でリンクでないディレクトリ・持ち主が自分・0700)と分かるものだけを消す(L-004・L-437)。
// 隠れた git は記録の時点のフォルダの写しを持つため、異常終了で残すと大きい。取り消しの控え(prompt-ide-agent-undo-)は対象にしない

/** 記録の一時ディレクトリの接頭辞(リポジトリの方式の記録も含む) */
export const AGENT_BASELINE_TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'

// 接頭辞(AGENT_BASELINE_TEMP_DIR_PREFIX。作る側の baselineTempDirPrefix と同じ定数から組み立て、名前の規則を 1 か所にする)の後に、
// pid は 1 以上の 10 桁まで、instanceId の 16 進は小文字 8 桁、mkdtemp が足す 6 文字。接頭辞は英小文字と - だけで、正規表現の
// 特別な文字を含まない
const TEMP_DIR_NAME_PATTERN = new RegExp(
  `^${AGENT_BASELINE_TEMP_DIR_PREFIX}([1-9][0-9]{0,9})-([0-9a-f]{8})-[A-Za-z0-9]{6}$`
)
// process.kill(pid, 0) に渡してよい pid の上限(L-020・L-046)
const MAX_PID = 2 ** 31 - 1

/** 起動ごとの接頭辞(mkdtemp に渡す。mkdtemp が 6 文字を足す) */
export function baselineTempDirPrefix(instanceId: string): string {
  return `${AGENT_BASELINE_TEMP_DIR_PREFIX}${instanceId}-`
}

/** 自分の形の名前なら pid と instanceId。形が違う(古い形の名前を含む)・pid が範囲外なら null(触らない) */
export function parseBaselineTempDirName(name: string): { pid: number; instanceId: string } | null {
  const match = TEMP_DIR_NAME_PATTERN.exec(name)
  if (match === null) return null
  const pid = Number(match[1])
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) return null
  return { pid, instanceId: `${match[1]}-${match[2]}` }
}

/**
 * 名前だけで決まる掃除の候補の条件: 自分の形の名前で、自分の instanceId でない(このインスタンスの記録は pid が無くても消さない。
 * L-435)なら、確かめる pid を返す。候補でなければ null。プロセスの有無と自分のものかは、この後に sweepStaleBaselineTempDirs が確かめる
 */
export function staleCandidatePidOf(name: string, instanceId: string): number | null {
  const parsed = parseBaselineTempDirName(name)
  if (parsed === null || parsed.instanceId === instanceId) return null
  return parsed.pid
}

/**
 * 自分のものか(存在ではなく lstat の結果で判定する。L-437): シンボリックリンクでないディレクトリで、Windows 以外は持ち主が自分の
 * uid と一致し、グループ・他人の権限が無い(mode & 0o077 が 0)。Windows 以外で自分の uid が分からなければ自分のものとしない
 */
export function isOwnBaselineTempDir(
  stat: Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'uid' | 'mode'>,
  { uid, platform }: { uid: number | null; platform: NodeJS.Platform }
): boolean {
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  if (platform === 'win32') return true
  return uid !== null && stat.uid === uid && (stat.mode & 0o077) === 0
}

export interface SweepBaselineTempDirsOptions {
  /** 一時ディレクトリの親(takeBaselineSnapshot の tempRoot と同じ。本番は OS の一時ディレクトリ) */
  tempRoot: string
  /** 自分の起動ごとの ID(このインスタンスの記録は消さない。L-435) */
  instanceId: string
  /** その pid のプロセスがこのマシンにあるか(isProcessAliveOnThisMachine。EPERM は生きているとみなす) */
  isProcessAlive: (pid: number) => boolean
  /** 自分の uid(既定は process.getuid。Windows には無い) */
  uid?: number | null
  platform?: NodeJS.Platform
}

/**
 * 前の起動の異常終了で残った記録の一時ディレクトリを消す。tempRoot の直下だけを見る。1 つの失敗(読めない・消せない)は握って
 * 次へ進み(L-010)、残ったものは次の起動で試す。消した数を返す(テスト用)。投げない
 */
export async function sweepStaleBaselineTempDirs({
  tempRoot,
  instanceId,
  isProcessAlive,
  uid = process.getuid?.() ?? null,
  platform = process.platform
}: SweepBaselineTempDirsOptions): Promise<number> {
  let names: string[]
  try {
    names = await readdir(tempRoot)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    const pid = staleCandidatePidOf(name, instanceId)
    if (pid === null) continue
    try {
      if (isProcessAlive(pid)) continue
      const dir = join(tempRoot, name)
      if (!isOwnBaselineTempDir(await lstat(dir), { uid, platform })) continue
      await rm(dir, { recursive: true, force: true })
      removed += 1
    } catch {
      // 消せなかったものは次の起動で試す(残りは続けて試す。L-010)
    }
  }
  return removed
}
