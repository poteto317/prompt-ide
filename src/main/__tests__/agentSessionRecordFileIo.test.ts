import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import {
  AGENT_SESSION_RECORD_FILE_NAMES,
  createAgentSessionRecordFileIo
} from '../agentSessionRecordFileIo'

const CLAUDE_FILE = 'agent-sessions.json'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir !== null) await removeTempPath(tempDir)
  tempDir = null
})

describe('AGENT_SESSION_RECORD_FILE_NAMES(種類ごとのファイル名)', () => {
  it('claude は段階 3a より前と同じ agent-sessions.json、copilot は agent-sessions-copilot.json', () => {
    expect(AGENT_SESSION_RECORD_FILE_NAMES).toEqual({
      claude: 'agent-sessions.json',
      copilot: 'agent-sessions-copilot.json'
    })
  })

  it('種類ごとに違うファイル(同じファイルを 2 つの store が書かない)', () => {
    const names = AGENT_CLI_KINDS.map((kind) => AGENT_SESSION_RECORD_FILE_NAMES[kind])
    expect(new Set(names).size).toBe(AGENT_CLI_KINDS.length)
  })
})

describe('createAgentSessionRecordFileIo', () => {
  it('userData/<ファイル名> を読み書きし、無いディレクトリは作る', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    const io = createAgentSessionRecordFileIo(dir, CLAUDE_FILE)
    await expect(io.read()).rejects.toMatchObject({ code: 'ENOENT' })
    await io.write('{"version":1,"folders":[]}')
    expect(await readFile(join(dir, CLAUDE_FILE), 'utf-8')).toBe('{"version":1,"folders":[]}')
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })

  it('copilot のファイル名で作った入出力は copilot のファイルにだけ書き、claude のファイルに触れない', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const io = createAgentSessionRecordFileIo(tempDir, AGENT_SESSION_RECORD_FILE_NAMES.copilot)
    await io.write('{"version":1,"folders":[]}')
    expect(await readFile(join(tempDir, 'agent-sessions-copilot.json'), 'utf-8')).toBe(
      '{"version":1,"folders":[]}'
    )
    await expect(readFile(join(tempDir, CLAUDE_FILE), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('書き込みは中身を丸ごと置き換える(追記しない)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const io = createAgentSessionRecordFileIo(tempDir, CLAUDE_FILE)
    await io.write('{"version":1,"folders":[{"key":"/a","ids":[]}]}')
    await io.write('{"version":1,"folders":[]}')
    await expect(io.read()).resolves.toBe('{"version":1,"folders":[]}')
  })

  it('作っただけではファイルもディレクトリも作らない(書き込むまで触らない)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-sessions-'))
    const dir = join(tempDir, 'nested')
    createAgentSessionRecordFileIo(dir, CLAUDE_FILE)
    await expect(readFile(join(dir, CLAUDE_FILE), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
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
