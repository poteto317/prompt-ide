import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_SESSION_RECORDS_FILE_NAME,
  createAgentSessionRecordFileIo
} from '../agentSessionRecordFileIo'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir !== null) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('createAgentSessionRecordFileIo', () => {
  it('userData/agent-sessions.json を読み書きし、無いディレクトリは作る', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    const io = createAgentSessionRecordFileIo(dir)
    await expect(io.read()).rejects.toMatchObject({ code: 'ENOENT' })
    await io.write('{"version":1,"folders":[]}')
    expect(await readFile(join(dir, AGENT_SESSION_RECORDS_FILE_NAME), 'utf-8')).toBe(
      '{"version":1,"folders":[]}'
    )
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })

  it('ファイル名は agent-sessions.json', () => {
    expect(AGENT_SESSION_RECORDS_FILE_NAME).toBe('agent-sessions.json')
  })

  it('書き込みは中身を丸ごと置き換える(追記しない)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const io = createAgentSessionRecordFileIo(tempDir)
    await io.write('{"version":1,"folders":[{"key":"/a","ids":[]}]}')
    await io.write('{"version":1,"folders":[]}')
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })

  it('作っただけではファイルもディレクトリも作らない(書き込むまで触らない)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    createAgentSessionRecordFileIo(dir)
    await expect(
      readFile(join(dir, AGENT_SESSION_RECORDS_FILE_NAME), 'utf-8')
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('agentSessionRecordStore の依存', () => {
  it('記録の規則のモジュールは fs・path を import しない(ファイルの入出力は注入する)', async () => {
    const source = await readFile(join(__dirname, '..', 'agentSessionRecordStore.ts'), 'utf-8')
    expect(source).not.toMatch(/from 'node:fs/)
    expect(source).not.toMatch(/from 'node:path/)
    expect(source).not.toMatch(/from 'electron'/)
  })
})
