import { vi } from 'vitest'
import type { AgentSessionRecordIo } from '../../agentSessionRecordStore'

// 起動の記録のファイルの入出力(AgentSessionRecordIo)の偽物。記録ストアの単体のテストと、記録ストアを本物のまま組み込む
// starter・IPC の受け口のテストが同じ偽物を使う(ファイルの形と「ファイルが無い」の表し方を 1 か所に置く)

/** 記録のファイルが無いときの読み込みの失敗(ENOENT。記録ストアは空の記録として扱い、ログに残さない) */
export const noRecordFile = (): NodeJS.ErrnoException =>
  Object.assign(new Error('no file'), { code: 'ENOENT' })

/** 記録のファイルの中身(記録ストアが読み書きする { version: 1, folders } の形) */
export const recordFileOf = (folders: { key: unknown; ids: unknown }[]): string =>
  JSON.stringify({ version: 1, folders })

export interface FakeRecordIo extends AgentSessionRecordIo {
  /** write に渡された中身(呼ばれた順) */
  writes: string[]
}

/**
 * 記録のファイルの入出力の偽物。read は content を返す(Error なら投げ、Promise ならその完了を待つ)。既定は「ファイルが無い」。
 * write は中身を writes に積む
 */
export function makeFakeRecordIo(
  content: string | Error | Promise<string> = noRecordFile()
): FakeRecordIo {
  const io: FakeRecordIo = {
    writes: [],
    read: vi.fn(async () => {
      if (content instanceof Error) throw content
      return content
    }),
    write: vi.fn(async (data: string) => {
      io.writes.push(data)
    })
  }
  return io
}
