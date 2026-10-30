import { CONFLICT_CHOICES, TAG_KINDS } from '@shared/types'
import type { ConflictChoice, CreateTagRequest, DiscardAllEntry } from '@shared/types'
import { isOneOf, isPlainObject } from '@shared/typeGuards'

// IPC 境界は任意の値を受け付けるため、service 層(startsWith 等)が TypeError で落ちる
// 前に引数の型を検証する。値の中身(実在するブランチか等)の検証は service 層が行う
export function assertBranchNameArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid branch name')
}

// force は厳密に boolean だけを受け付ける('true' 等の truthy な値で強制削除されないため)
export function assertForceFlagArg(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid force flag')
}

export function assertStashMessageArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid stash message')
}

// 値の形式(40 桁の 16 進数)と、現在の一覧にあるかの検証は service 層が行う
export function assertStashIdArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid stash id')
}

// パッチの中身(対象ファイルが 1 件だけか等)の検証は service 層が行う
export function assertPatchArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid patch')
}

// 実行時の status との一致は service 層が確かめる。ここでは {path: string, status: 2 文字の文字列} の
// 配列であることだけを検証する
export function assertDiscardEntriesArg(value: unknown): asserts value is DiscardAllEntry[] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.path === 'string' &&
        typeof entry.status === 'string' &&
        entry.status.length === 2
    )
  if (!valid) throw new Error('Invalid entries')
}

const MAX_CONFLICT_ENTRIES = 1000

// 値の一致(現在のブロックの構成と同じか)は service 層が確かめる。ここでは 40 桁の 16 進の
// 文字列の配列(最大 1000 件)であることだけを検証する
export function assertConflictDigestsArg(value: unknown): asserts value is string[] {
  const valid =
    Array.isArray(value) &&
    value.length <= MAX_CONFLICT_ENTRIES &&
    value.every((v) => typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v))
  if (!valid) throw new Error('Invalid digests')
}

// 整数の番号(文字列キー)→ 'ours' | 'theirs' | 'both' のオブジェクト(最大 1000 件)。
// 番号がブロック数の範囲内かは service 層が確かめる。キーは Object.keys で調べるため、
// __proto__ / constructor / prototype などの特殊キーは整数でないものとして拒否される。
// 値は Object.keys で得たキーから読むので、prototype チェーン上の値は見ない
export function assertConflictChoicesArg(
  value: unknown
): asserts value is Record<number, ConflictChoice> {
  if (!isPlainObject(value)) {
    throw new Error('Invalid choices')
  }
  const keys = Object.keys(value)
  const valid =
    keys.length <= MAX_CONFLICT_ENTRIES &&
    keys.every((key) => /^(0|[1-9]\d{0,8})$/.test(key) && isOneOf(CONFLICT_CHOICES, value[key]))
  if (!valid) throw new Error('Invalid choices')
}

export function assertConflictSideArg(value: unknown): asserts value is 'ours' | 'theirs' {
  if (value !== 'ours' && value !== 'theirs') throw new Error('Invalid side')
}

// { name: string, kind: 'lightweight' | 'annotated', message: string } のオブジェクトであることだけを検証する。
// 値の中身(名前の規則・重複・メッセージの空)は service 層が検証する。余分なキーは呼び出し側で
// 詰め直して service に渡さない
export function assertCreateTagArg(value: unknown): asserts value is CreateTagRequest {
  if (!isPlainObject(value)) {
    throw new Error('Invalid tag request')
  }
  const { name, kind, message } = value
  const valid = typeof name === 'string' && typeof message === 'string' && isOneOf(TAG_KINDS, kind)
  if (!valid) throw new Error('Invalid tag request')
}

// 文字列であることだけを検証する。値の中身(許可リスト・長さ・制御文字)は service 層が検証する
export function assertRemoteUrlArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid remote url')
}
