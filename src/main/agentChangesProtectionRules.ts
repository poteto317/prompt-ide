// 記録の tree を gc から守る専用の ref の規則(設計書「記録の blob を gc から守る」)。ref の名前の形(作る・解釈する)、
// object の ID の形、掃除で消す候補か、同期で ref に行う書き込みと失敗の後の読み直しの分類を、git を実行せずに決める。
// git の実行と出力の解析は agentChangesProtectionRef に置く(registry はこのファイルの規則と、注入された git の操作だけを使う)

/**
 * アプリ自身が書く ref の名前空間(refs/<これ>/…)。この下の ref は git status に出ないため、開いているフォルダの監視
 * (folderChangeClassifier)は .git/refs/<これ>/ の下の書き込みを捨てる
 */
export const APP_REFS_NAMESPACE = 'prompt-ide'
export const AGENT_CHANGES_PROTECTION_REF_PREFIX = `refs/${APP_REFS_NAMESPACE}/agent-changes/`

const REF_NAME_PATTERN =
  /^refs\/prompt-ide\/agent-changes\/([1-9][0-9]*)-([0-9a-f]{8})\/([1-9][0-9]*)$/
// object の ID(SHA-1 は 40 桁・SHA-256 は 64 桁)
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** object の ID の形か(SHA-1 の 40 桁・SHA-256 の 64 桁の小文字の 16 進) */
export function isObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value)
}

/** 保護の tree の項目(baseline: 累積の始点の tree、run-<runId>: 区切りの tree) */
export interface ProtectionTreeEntry {
  name: string
  tree: string
}

export interface ProtectionRefListing {
  refName: string
  value: string
  objectType: string
}

export interface ParsedProtectionRefName {
  pid: number
  instanceId: string
  recordSerial: number
}

export function createProtectionInstanceId(pid: number, randomHex: string): string {
  return `${pid}-${randomHex}`
}

export function protectionRefName(instanceId: string, recordSerial: number): string {
  return `${AGENT_CHANGES_PROTECTION_REF_PREFIX}${instanceId}/${recordSerial}`
}

/** 自分の形の名前なら pid・instanceId・番号。形が違えば null(掃除で触らない) */
export function parseProtectionRefName(refName: string): ParsedProtectionRefName | null {
  const match = REF_NAME_PATTERN.exec(refName)
  if (match === null) return null
  const pid = Number(match[1])
  const recordSerial = Number(match[3])
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(recordSerial)) return null
  return { pid, instanceId: `${match[1]}-${match[2]}`, recordSerial }
}

/**
 * 掃除で消す候補か(値の tree の形は別に確かめる): 自分の形の名前で、自分のインスタンスなら残す番号に無いもの・別のインスタンスなら
 * その pid のプロセスが無いもののうち、一覧の種類が tree で値が object の ID の形のもの
 */
export function isSweepCandidate(
  listing: ProtectionRefListing,
  instanceId: string,
  keep: ReadonlySet<number>,
  isProcessAlive: (pid: number) => boolean
): boolean {
  const parsed = parseProtectionRefName(listing.refName)
  if (parsed === null) return false
  const stale =
    parsed.instanceId === instanceId ? !keep.has(parsed.recordSerial) : !isProcessAlive(parsed.pid)
  return stale && listing.objectType === 'tree' && isObjectId(listing.value)
}

/** 保護の同期で ref に行う書き込み(前に書いた値 written とあるべき値 desired から決める。どちらも null は「無い」) */
export type ProtectionRefWrite =
  | { kind: 'none' }
  | { kind: 'create'; value: string }
  | { kind: 'update'; value: string; expected: string }
  | { kind: 'remove'; expected: string }

export function protectionRefWriteOf(
  written: string | null,
  desired: string | null
): ProtectionRefWrite {
  if (written === null)
    return desired === null ? { kind: 'none' } : { kind: 'create', value: desired }
  if (desired === null) return { kind: 'remove', expected: written }
  return written === desired
    ? { kind: 'none' }
    : { kind: 'update', value: desired, expected: written }
}

/**
 * 書き込みの失敗の後に読み直した今の値 current の分類。あるべき値なら applied(書けていた)、前に書いた値のまま(作るときは
 * 「無い」まま)なら retry(次の同期で試し直す)、それ以外は abandoned(利用者が消した・書き換えた)
 */
export function classifyProtectionReread(
  current: string | null,
  desired: string | null,
  written: string | null
): 'applied' | 'retry' | 'abandoned' {
  if (current === desired) return 'applied'
  if (current === written) return 'retry'
  return 'abandoned'
}
