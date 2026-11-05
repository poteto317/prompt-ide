# エージェント向けの指示ファイルの編集支援 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エクスプローラーの上部に「エージェントの指示ファイル」の節を置き、選んでいるエージェント CLI の指示ファイル(`CLAUDE.md` など)を開く・無ければ雛形で作って開く。

**Architecture:** 指示ファイルの表(CLI の種類ごと)を `src/shared` に置き、main と renderer が同じ表を読む。renderer は表の識別子だけを IPC で送り、main が表からパスと雛形を決めて `wx` で作る(失敗は理由で返す)。renderer はファイルツリーをたどって有無を判定し、作成は既存のファイル操作のロックを通してからツリーを読み直して開く。

**Tech Stack:** Electron + React + TypeScript、Vitest + Testing Library、node:fs/promises

**設計書:** `docs/superpowers/specs/2026-11-05-agent-instruction-files-design.md`(各タスクの前に該当の節を読む)

## Global Constraints

- **コミットしない。** このプランの各タスクに「Commit」の手順は無い(プロジェクトの CLAUDE.md の規則。コミットは後の `/commit-ja` で行う)
- 型だけの import は `import type`。関数には戻り値の型を書く(`explicit-function-return-type`。テストを含む)
- テストの名前(`it` の文字列)は日本語で「条件 → 期待する結果」
- `act(...).then(...)` の形で書かない。hook の非同期の拒否は `act` の中で `try/catch` で受ける
- 一時ディレクトリの再帰削除は `src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPath` を使う(素の `rm -r` は ESLint が検出する。L-618)
- 画面の文言・IPC の結果に、パス・例外の文言を入れない(L-017)
- 各タスクの終わりに、そのタスクで変えたファイルへ `npx eslint <パス...> --max-warnings 0` と `npm run typecheck` を通す。整形の崩れは `npx prettier --write <パス>` で直す
- 知見の ID(`$DEV_FLOW_KIT/lessons/review-lessons.md`): L-001, L-004, L-009, L-016, L-017, L-018, L-019, L-044, L-060, L-061, L-466, L-653

## ファイルの構成

| ファイル | 役割 |
| --- | --- |
| `src/shared/agentInstructionFiles.ts`(新規) | CLI ごとの指示ファイルの表・雛形・`findAgentInstructionFile` |
| `src/shared/types/agentInstructions.ts`(新規) | IPC の結果の型 `AgentInstructionCreateResult` |
| `src/shared/types.ts` | 上の型を再エクスポート |
| `src/main/folderAccessManager.ts` | `FolderAccessDeniedError` を足して範囲外の拒否で投げる |
| `src/main/agentInstructionFileCreator.ts`(新規) | 作成の手順(mkdir → 範囲の検証 → `wx` で書く) |
| `src/main/handlers/agentInstructionsHandlers.ts`(新規) | IPC `agentInstructions:create` の受け口・引数の検証・理由への変換 |
| `src/main/ipcHandlers.ts` | 受け口の登録 |
| `src/preload/api.ts`・`src/preload/index.d.ts` | `createAgentInstructionFile` |
| `src/renderer/src/lib/agentInstructionsApi.ts`(新規) | `window.api` の薄い包み |
| `src/renderer/src/lib/agentInstructionFileLookup.ts`(新規) | ツリーを名前でたどる純粋な関数 |
| `src/renderer/src/lib/agentInstructionMessages.ts`(新規) | 固定の文言 |
| `src/renderer/src/hooks/agentInstructionFileCreation.ts`(新規) | ロック → IPC → ツリーの読み直しの手順(`useFileTreeOperations` から使う純粋でない関数) |
| `src/renderer/src/hooks/useFileTreeOperations.ts` | `reloadTree` の切り出しと `createAgentInstructionFile` |
| `src/renderer/src/hooks/useFileSystem.ts` | `createAgentInstructionFile` を公開 |
| `src/renderer/src/hooks/useAgentInstructionFiles.ts`(新規) | 節の状態(行・作成中・文言)と `open`・`create` |
| `src/renderer/src/types.ts` | `AgentInstructionFileRow`・`AgentInstructionsPanelState` |
| `src/renderer/src/hooks/useAppState.ts` | hook の呼び出し・git の再取得つきの包み・`agentInstructions` の公開 |
| `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`(新規) | 節の表示 |
| `src/renderer/src/components/explorer/ExplorerPanel.tsx`・`Sidebar.tsx`・`App.tsx` | 配線(必須の props。L-060) |
| `src/renderer/src/assets/main.css` | 節のスタイル |
| `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts`(新規) | テスト用の状態 |
| `src/renderer/src/__tests__/setup.ts` | `window.api.createAgentInstructionFile` の既定のスタブ |

---

### Task 1: 指示ファイルの表と IPC の結果の型(shared)

**Files:**
- Create: `src/shared/agentInstructionFiles.ts`
- Create: `src/shared/types/agentInstructions.ts`
- Modify: `src/shared/types.ts`(先頭の `export type * from ...` の並びに 1 行足す)
- Test: `src/shared/__tests__/agentInstructionFiles.test.ts`

**Interfaces:**
- Produces:
  - `type AgentInstructionFileId = 'claude-root' | 'claude-dot' | 'claude-local' | 'copilot-agents' | 'copilot-github'`
  - `type AgentInstructionSegments = readonly [string] | readonly [string, string]`
  - `interface AgentInstructionFile { id: AgentInstructionFileId; segments: AgentInstructionSegments; description: string; template: string }`
  - `const AGENT_INSTRUCTION_FILES: Record<AgentCliKind, readonly AgentInstructionFile[]>`
  - `function findAgentInstructionFile(cliKind: AgentCliKind, id: unknown): AgentInstructionFile | null`(その CLI の表に無ければ null)
  - `function agentInstructionRelativePath(file: AgentInstructionFile): string`(`segments.join('/')`)
  - `type AgentInstructionCreateFailureReason = 'exists' | 'outside' | 'failed'`
  - `type AgentInstructionCreateResult = { ok: true } | { ok: false; reason: AgentInstructionCreateFailureReason }`(`@shared/types` から import できる)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/shared/__tests__/agentInstructionFiles.test.ts
import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '../agentCliKinds'
import {
  AGENT_INSTRUCTION_FILES,
  agentInstructionRelativePath,
  findAgentInstructionFile
} from '../agentInstructionFiles'

describe('AGENT_INSTRUCTION_FILES', () => {
  it('すべての CLI の種類に行がある → 1 件以上', () => {
    for (const kind of AGENT_CLI_KINDS) {
      expect(AGENT_INSTRUCTION_FILES[kind].length).toBeGreaterThan(0)
    }
  })

  it('id は全体で一意', () => {
    const ids = AGENT_CLI_KINDS.flatMap((kind) => AGENT_INSTRUCTION_FILES[kind].map((f) => f.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('claude は CLAUDE.md・.claude/CLAUDE.md・CLAUDE.local.md の順', () => {
    expect(AGENT_INSTRUCTION_FILES.claude.map(agentInstructionRelativePath)).toEqual([
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'CLAUDE.local.md'
    ])
  })

  it('copilot は AGENTS.md・.github/copilot-instructions.md の順', () => {
    expect(AGENT_INSTRUCTION_FILES.copilot.map(agentInstructionRelativePath)).toEqual([
      'AGENTS.md',
      '.github/copilot-instructions.md'
    ])
  })

  it('segments が 2 つのときの 1 つ目は .claude か .github', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const file of AGENT_INSTRUCTION_FILES[kind]) {
        if (file.segments.length === 2) expect(['.claude', '.github']).toContain(file.segments[0])
      }
    }
  })

  it('各 segment は区切りや .. を含まない', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const file of AGENT_INSTRUCTION_FILES[kind]) {
        for (const segment of file.segments) {
          expect(segment).not.toMatch(/[\\/]/)
          expect(segment).not.toBe('..')
          expect(segment).not.toBe('')
        }
      }
    }
  })

  it('雛形は見出しで始まり改行で終わる。CLAUDE.local.md だけ「個人の指示」', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const file of AGENT_INSTRUCTION_FILES[kind]) {
        const heading = file.id === 'claude-local' ? '# 個人の指示\n' : '# プロジェクトの指示\n'
        expect(file.template.startsWith(heading)).toBe(true)
        expect(file.template.endsWith('\n')).toBe(true)
        expect(file.template).toContain('## よく使うコマンド')
      }
    }
  })
})

describe('findAgentInstructionFile', () => {
  it('CLI の表にある id → その行', () => {
    expect(findAgentInstructionFile('claude', 'claude-dot')?.segments).toEqual(['.claude', 'CLAUDE.md'])
  })

  it('別の CLI の id → null', () => {
    expect(findAgentInstructionFile('claude', 'copilot-agents')).toBeNull()
  })

  it.each([null, undefined, 1, '', 'unknown', {}, ['claude-root']])('不正な id %p → null', (id) => {
    expect(findAgentInstructionFile('claude', id)).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/shared/__tests__/agentInstructionFiles.test.ts`
Expected: FAIL(`../agentInstructionFiles` が無い)

- [ ] **Step 3: 実装する**

```ts
// src/shared/agentInstructionFiles.ts
// エージェント CLI が読む指示ファイルの表(設計書 2026-11-05「指示ファイルの表」)。main(作成のパスと雛形)と renderer(一覧・有無の判定)が
// 同じ表を読む。renderer は id だけを IPC で送り、パスと中身は main がこの表から決める(L-018・L-019)
import type { AgentCliKind } from './agentCliKinds'

export type AgentInstructionFileId =
  | 'claude-root'
  | 'claude-dot'
  | 'claude-local'
  | 'copilot-agents'
  | 'copilot-github'

/** フォルダからの相対パスを区切りごとに分けたもの。2 つのときの 1 つ目は、作成のときに作ってよいフォルダ */
export type AgentInstructionSegments = readonly [string] | readonly [string, string]

export interface AgentInstructionFile {
  /** IPC で送る識別子(表の全体で一意) */
  id: AgentInstructionFileId
  segments: AgentInstructionSegments
  /** 一覧に出す短い説明 */
  description: string
  /** 作成したときに書く雛形(見出しだけ。末尾は改行) */
  template: string
}

const TEMPLATE_SECTIONS = '\n## 概要\n\n## よく使うコマンド\n\n## コーディングのルール\n'
const PROJECT_TEMPLATE = `# プロジェクトの指示\n${TEMPLATE_SECTIONS}`
const PERSONAL_TEMPLATE = `# 個人の指示\n${TEMPLATE_SECTIONS}`

export const AGENT_INSTRUCTION_FILES: Record<AgentCliKind, readonly AgentInstructionFile[]> = {
  claude: [
    { id: 'claude-root', segments: ['CLAUDE.md'], description: '共有の指示', template: PROJECT_TEMPLATE },
    {
      id: 'claude-dot',
      segments: ['.claude', 'CLAUDE.md'],
      description: '共有の指示(.claude フォルダ)',
      template: PROJECT_TEMPLATE
    },
    {
      id: 'claude-local',
      segments: ['CLAUDE.local.md'],
      description: '個人の指示',
      template: PERSONAL_TEMPLATE
    }
  ],
  copilot: [
    { id: 'copilot-agents', segments: ['AGENTS.md'], description: '共有の指示', template: PROJECT_TEMPLATE },
    {
      id: 'copilot-github',
      segments: ['.github', 'copilot-instructions.md'],
      description: '共有の指示(.github フォルダ)',
      template: PROJECT_TEMPLATE
    }
  ]
}

/** その CLI の表にある id なら行を返す。表に無い・不正な値は null(既定の行に読み替えない。L-044) */
export function findAgentInstructionFile(
  cliKind: AgentCliKind,
  id: unknown
): AgentInstructionFile | null {
  return AGENT_INSTRUCTION_FILES[cliKind].find((file) => file.id === id) ?? null
}

/** 一覧と aria-label に出す相対パス(区切りは /) */
export function agentInstructionRelativePath(file: AgentInstructionFile): string {
  return file.segments.join('/')
}
```

```ts
// src/shared/types/agentInstructions.ts
/** 指示ファイルの作成(agentInstructions:create)の失敗の理由。画面の文言は renderer が理由から選ぶ(L-017) */
export type AgentInstructionCreateFailureReason = 'exists' | 'outside' | 'failed'

/** agentInstructions:create の結果。ok: true は「新しく作った」ことだけを意味する */
export type AgentInstructionCreateResult =
  | { ok: true }
  | { ok: false; reason: AgentInstructionCreateFailureReason }
```

`src/shared/types.ts` の `export type * from './types/agentNotification'` の次の行に足す:

```ts
export type * from './types/agentInstructions'
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/shared/__tests__/agentInstructionFiles.test.ts`
Expected: PASS。続けて `npm run typecheck` と `npx eslint src/shared --max-warnings 0`

---

### Task 2: main の作成の手順と IPC の受け口

**Files:**
- Modify: `src/main/folderAccessManager.ts`
- Create: `src/main/agentInstructionFileCreator.ts`
- Create: `src/main/handlers/agentInstructionsHandlers.ts`
- Modify: `src/main/ipcHandlers.ts`(`registerFileSystemHandlers(ipcMain, folderAccess)` の次の行)
- Test: `src/main/__tests__/folderAccessManager.test.ts`(追記)
- Test: `src/main/__tests__/agentInstructionFileCreator.integration.test.ts`(新規。実ファイル)
- Test: `src/main/__tests__/handlers/agentInstructionsHandlers.test.ts`(新規)

**Interfaces:**
- Consumes: Task 1 の `AgentInstructionFile`・`findAgentInstructionFile`・`AgentInstructionCreateResult`
- Produces:
  - `class FolderAccessDeniedError extends Error`(`src/main/folderAccessManager.ts` から export。`name` は設定しない)
  - `createAgentInstructionFile(allowedFolder: string, folderAccess: Pick<FolderAccessManager, 'assertParentWithinFolder'>, file: AgentInstructionFile): Promise<void>`
  - `toAgentInstructionCreateFailureReason(err: unknown): AgentInstructionCreateFailureReason`
  - `registerAgentInstructionsHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void`
  - IPC チャンネル `agentInstructions:create`、引数 `(cliKind: unknown, fileId: unknown)`、戻り値 `AgentInstructionCreateResult`

- [ ] **Step 1: `FolderAccessDeniedError` の失敗するテストを書く**

`src/main/__tests__/folderAccessManager.test.ts` を読み、既存の `assertWithinFolder`・`assertParentWithinFolder` の範囲外のテストのモック(`realpath`)の作り方に合わせて、次を足す(import に `FolderAccessDeniedError` を足す):

```ts
describe('FolderAccessDeniedError', () => {
  it('assertWithinFolder の範囲外 → FolderAccessDeniedError で、文言は Access denied のまま', async () => {
    // 既存の範囲外のテストと同じ realpath のモックで、許可フォルダの外を返させる
    const promise = manager.assertWithinFolder('/allowed', '/outside/a.txt')
    await expect(promise).rejects.toBeInstanceOf(FolderAccessDeniedError)
    await expect(promise).rejects.toThrow('Access denied: /outside/a.txt')
  })

  it('assertParentWithinFolder の範囲外 → FolderAccessDeniedError', async () => {
    await expect(
      manager.assertParentWithinFolder('/allowed', '/outside')
    ).rejects.toBeInstanceOf(FolderAccessDeniedError)
  })

  it('name は Error のまま(IPC 越しの文言の前置きを変えない)', () => {
    expect(new FolderAccessDeniedError('x').name).toBe('Error')
  })
})
```

(既存のファイルは `beforeEach` で `mockRealpath` を `resolvePath` にしているので、`/outside/a.txt` はそのまま範囲外になる。各 `it` の先頭で `const manager = new FolderAccessManager()` と書く)

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/folderAccessManager.test.ts`
Expected: FAIL(`FolderAccessDeniedError` が無い)

- [ ] **Step 3: `FolderAccessDeniedError` を実装する**

`src/main/folderAccessManager.ts` の import の後に:

```ts
/** 開いているフォルダの外を指したときの拒否。受け口が範囲外を他の失敗(realpath の ENOENT など)と見分けるために使う。
 *  name は設定しない(IPC 越しに renderer へ届く `Error invoking remote method '...': Error: Access denied: ...` を変えないため) */
export class FolderAccessDeniedError extends Error {}
```

`assertWithinFolder` の 2 か所と `assertParentWithinFolder` の 1 か所の `throw new Error(\`Access denied: ${...}\`)` を `throw new FolderAccessDeniedError(\`Access denied: ${...}\`)` に変える(文言はそのまま)。

Run: `npx vitest run src/main/__tests__/folderAccessManager.test.ts src/main/__tests__/handlers`
Expected: PASS(既存のテストは文言の部分一致なので通る)

- [ ] **Step 4: creator の失敗するテストを書く(実ファイル)**

```ts
// src/main/__tests__/agentInstructionFileCreator.integration.test.ts
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FolderAccessManager, FolderAccessDeniedError } from '../folderAccessManager'
import { createAgentInstructionFile } from '../agentInstructionFileCreator'
import { AGENT_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import { removeTempPath } from '../../shared/__tests__/helpers/tempDirGuard'

const fileOf = (id: AgentInstructionFile['id']): AgentInstructionFile => {
  const found = [...AGENT_INSTRUCTION_FILES.claude, ...AGENT_INSTRUCTION_FILES.copilot].find(
    (f) => f.id === id
  )
  if (found === undefined) throw new Error(`no file: ${id}`)
  return found
}

let root: string
let folder: string
let outside: string
const access = new FolderAccessManager()

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agent-instructions-')))
  folder = join(root, 'project')
  outside = join(root, 'outside')
  await mkdir(folder)
  await mkdir(outside)
})

afterEach(async () => {
  await removeTempPath(root)
})

describe('createAgentInstructionFile', () => {
  it('CLAUDE.md が無い → 雛形で作る', async () => {
    await createAgentInstructionFile(folder, access, fileOf('claude-root'))
    expect(await readFile(join(folder, 'CLAUDE.md'), 'utf-8')).toBe(fileOf('claude-root').template)
  })

  it('.claude が無い → フォルダも作って .claude/CLAUDE.md を書く', async () => {
    await createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    expect(await readFile(join(folder, '.claude', 'CLAUDE.md'), 'utf-8')).toBe(
      fileOf('claude-dot').template
    )
  })

  it('.claude が既にある → そのまま中に作る', async () => {
    await mkdir(join(folder, '.claude'))
    await writeFile(join(folder, '.claude', 'settings.json'), '{}')
    await createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    expect((await readdir(join(folder, '.claude'))).sort()).toEqual(['CLAUDE.md', 'settings.json'])
  })

  it('既にある → EEXIST で失敗し、中身は変わらない', async () => {
    await writeFile(join(folder, 'AGENTS.md'), 'mine')
    await expect(
      createAgentInstructionFile(folder, access, fileOf('copilot-agents'))
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(folder, 'AGENTS.md'), 'utf-8')).toBe('mine')
  })

  it('.claude がフォルダの外へのリンク → FolderAccessDeniedError で、外に何も作らない', async () => {
    await symlink(outside, join(folder, '.claude'))
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    ).rejects.toBeInstanceOf(FolderAccessDeniedError)
    expect(await readdir(outside)).toEqual([])
  })

  it('.claude が同名のファイル → ENOTDIR で失敗し、ファイルは変わらない', async () => {
    await writeFile(join(folder, '.claude'), 'file')
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    ).rejects.toMatchObject({ code: 'ENOTDIR' })
    expect(await readFile(join(folder, '.claude'), 'utf-8')).toBe('file')
  })

  it('CLAUDE.md がぶら下がったリンク → EEXIST で、リンク先を作らない', async () => {
    const target = join(outside, 'created.md')
    await symlink(target, join(folder, 'CLAUDE.md'))
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-root'))
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readdir(outside)).toEqual([])
  })

  it('.claude がぶら下がったリンク → ENOENT で失敗し、外に何も作らない', async () => {
    await symlink(join(outside, 'missing'), join(folder, '.claude'))
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(outside)).toEqual([])
  })
})
```

(Windows ではシンボリックリンクの作成に権限が要るため、リンクを使う 3 件は `it.skipIf(process.platform === 'win32')` にする)

- [ ] **Step 5: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/agentInstructionFileCreator.integration.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 6: creator を実装する**

```ts
// src/main/agentInstructionFileCreator.ts
// 指示ファイルの作成(設計書 2026-11-05「作成の手順」)。途中の失敗は投げ、受け口が理由に変える
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import { createFileContent } from './fileSystem'
import { isFsError } from './fsErrors'
import type { FolderAccessManager } from './folderAccessManager'

/**
 * 許可フォルダ(realpath 済み)の下に、表の行の雛形でファイルを作る。既にあるものは決して上書きしない(flag 'wx')。
 * 1 で作ったフォルダは、3 が失敗しても消さない(空のフォルダが残るだけ。消す後始末は、作った後に入った他人の物を消しうる。L-004)
 */
export async function createAgentInstructionFile(
  allowedFolder: string,
  folderAccess: Pick<FolderAccessManager, 'assertParentWithinFolder'>,
  file: AgentInstructionFile
): Promise<void> {
  const [first, second] = file.segments
  let parent = allowedFolder
  let fileName = first
  if (second !== undefined) {
    // 1. 親のフォルダ(.claude・.github)を作る。既にあれば(リンクを含む)そのまま 2 の検証に任せる
    parent = join(allowedFolder, first)
    fileName = second
    try {
      await mkdir(parent)
    } catch (err) {
      if (!isFsError(err, 'EEXIST')) throw err
    }
  }
  // 2. 親を realpath して許可フォルダの中か確かめる(.claude が外へのリンクならここで拒否。L-016)
  const resolvedParent = await folderAccess.assertParentWithinFolder(allowedFolder, parent)
  // 3. 排他的に作る。既にあれば EEXIST、ぶら下がったリンクも辿らない
  await createFileContent(join(resolvedParent, fileName), file.template)
}
```

Run: `npx vitest run src/main/__tests__/agentInstructionFileCreator.integration.test.ts`
Expected: PASS

- [ ] **Step 7: 受け口の失敗するテストを書く**

```ts
// src/main/__tests__/handlers/agentInstructionsHandlers.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { FolderAccessDeniedError } from '../../folderAccessManager'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())
vi.mock('../../agentInstructionFileCreator', () => ({ createAgentInstructionFile: mockCreate }))

import {
  registerAgentInstructionsHandlers,
  toAgentInstructionCreateFailureReason
} from '../../handlers/agentInstructionsHandlers'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const fsError = (code: string): NodeJS.ErrnoException => {
  const err = new Error(`${code}: /secret/path`) as NodeJS.ErrnoException
  err.code = code
  return err
}

const register = (folder: string | undefined): Handler => {
  const folderAccess = { get: vi.fn(() => folder) } as unknown as FolderAccessManager
  registerAgentInstructionsHandlers({ handle: mockHandle } as never, folderAccess)
  const call = mockHandle.mock.calls.find(([channel]) => channel === 'agentInstructions:create')
  if (call === undefined) throw new Error('not registered')
  return call[1] as Handler
}

const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent

describe('agentInstructions:create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('正しい引数 → 表の行で作成を呼び { ok: true }', async () => {
    mockCreate.mockResolvedValue(undefined)
    const handler = register('/allowed')
    await expect(handler(event, 'claude', 'claude-dot')).resolves.toEqual({ ok: true })
    expect(mockCreate).toHaveBeenCalledWith(
      '/allowed',
      expect.anything(),
      expect.objectContaining({ id: 'claude-dot', segments: ['.claude', 'CLAUDE.md'] })
    )
  })

  it.each([
    ['不正な cliKind', 'codex', 'claude-root'],
    ['null の cliKind', null, 'claude-root'],
    ['不正な fileId', 'claude', '../etc'],
    ['CLI に合わない fileId', 'claude', 'copilot-agents'],
    ['数の fileId', 'copilot', 1]
  ])('%s → 例外にし、作成を呼ばない', async (_label, cliKind, fileId) => {
    const handler = register('/allowed')
    await expect(handler(event, cliKind, fileId)).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('フォルダを開いていない → failed で、作成を呼ばない', async () => {
    const handler = register(undefined)
    await expect(handler(event, 'claude', 'claude-root')).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['EEXIST', fsError('EEXIST'), 'exists'],
    ['ENOTDIR', fsError('ENOTDIR'), 'exists'],
    ['範囲外', new FolderAccessDeniedError('Access denied: /secret'), 'outside'],
    ['ENOENT', fsError('ENOENT'), 'failed'],
    ['EACCES', fsError('EACCES'), 'failed'],
    ['文字列', 'boom', 'failed']
  ])('作成の失敗 %s → 理由 %s を返し、文言・パスを返さない', async (_label, err, reason) => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockCreate.mockRejectedValue(err)
      const handler = register('/allowed')
      const result = await handler(event, 'claude', 'claude-root')
      expect(result).toEqual({ ok: false, reason })
      expect(JSON.stringify(result)).not.toContain('/secret')
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('toAgentInstructionCreateFailureReason', () => {
  it('EEXIST → exists', () => {
    expect(toAgentInstructionCreateFailureReason(fsError('EEXIST'))).toBe('exists')
  })
})
```

- [ ] **Step 8: 失敗を確かめる**

Run: `npx vitest run src/main/__tests__/handlers/agentInstructionsHandlers.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 9: 受け口を実装して登録する**

```ts
// src/main/handlers/agentInstructionsHandlers.ts
// 指示ファイルの作成の受け口(設計書 2026-11-05「IPC agentInstructions:create」)。引数の検証の失敗だけを IPC の例外にし、
// 作成の失敗は理由で返す(画面の文言は renderer が理由から選ぶ。例外の文言にはパスが入るので送らない。L-017)
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isAgentCliKind } from '@shared/agentCliKinds'
import { findAgentInstructionFile } from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type {
  AgentInstructionCreateFailureReason,
  AgentInstructionCreateResult
} from '@shared/types'
import { createAgentInstructionFile } from '../agentInstructionFileCreator'
import { FolderAccessDeniedError } from '../folderAccessManager'
import type { FolderAccessManager } from '../folderAccessManager'
import { isFsError } from '../fsErrors'

/** IPC の引数を検証して表の行を返す。不正なら投げる(既定の行に読み替えない。L-044) */
function parseCreateArgs(cliKind: unknown, fileId: unknown): AgentInstructionFile {
  if (!isAgentCliKind(cliKind)) throw new Error('不正なエージェント CLI の種類です')
  const file = findAgentInstructionFile(cliKind, fileId)
  if (file === null) throw new Error('不正な指示ファイルの指定です')
  return file
}

export function toAgentInstructionCreateFailureReason(
  err: unknown
): AgentInstructionCreateFailureReason {
  if (err instanceof FolderAccessDeniedError) return 'outside'
  if (isFsError(err, 'EEXIST') || isFsError(err, 'ENOTDIR')) return 'exists'
  return 'failed'
}

export function registerAgentInstructionsHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager
): void {
  ipcMain.handle(
    'agentInstructions:create',
    async (
      event: IpcMainInvokeEvent,
      cliKind: unknown,
      fileId: unknown
    ): Promise<AgentInstructionCreateResult> => {
      const file = parseCreateArgs(cliKind, fileId)
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) return { ok: false, reason: 'failed' }
      try {
        await createAgentInstructionFile(allowedFolder, folderAccess, file)
        return { ok: true }
      } catch (err) {
        console.error('[agentInstructions:create] failed:', err)
        return { ok: false, reason: toAgentInstructionCreateFailureReason(err) }
      }
    }
  )
}
```

`src/main/ipcHandlers.ts`: import に `import { registerAgentInstructionsHandlers } from './handlers/agentInstructionsHandlers'` を足し、`registerFileSystemHandlers(ipcMain, folderAccess)` の次の行に `registerAgentInstructionsHandlers(ipcMain, folderAccess)` を足す。

登録漏れを検出するテスト(L-060)を `src/main/__tests__/ipcHandlers.test.ts` に足す。このファイルは各 handler のモジュールを `vi.hoisted` + `vi.mock` で差し替え、`registerXxx` の呼ばれ方を 1 件ずつ確かめる流儀(`registerFileSystemHandlers` のテストが 242 行付近)。同じ形で:

```ts
const mockRegisterAgentInstructionsHandlers = vi.hoisted(() => vi.fn())
vi.mock('../handlers/agentInstructionsHandlers', () => ({
  registerAgentInstructionsHandlers: mockRegisterAgentInstructionsHandlers
}))
```

を既存のモックの並びに足し、

```ts
  it('registerAgentInstructionsHandlers を ipcMain と registerFileSystemHandlers と同じ FolderAccessManager で呼び出す', () => {
    registerIpcHandlers(mockIpcMain)
    expect(mockRegisterAgentInstructionsHandlers).toHaveBeenCalledOnce()
    const [ipcMain, folderAccess] = mockRegisterAgentInstructionsHandlers.mock.calls[0]
    expect(ipcMain).toBe(mockIpcMain)
    // 同じインスタンス(深い比較ではなく参照)。別の FolderAccessManager だと許可フォルダが常に無い
    expect(folderAccess).toBe(mockRegisterFileSystemHandlers.mock.calls[0][1])
  })
```

を `registerFileSystemHandlers` のテストの次に足す。登録の行を足す前に流して落ちることを確かめる。

- [ ] **Step 10: 通ることを確かめる**

Run: `npx vitest run src/main/__tests__/handlers/agentInstructionsHandlers.test.ts src/main/__tests__/agentInstructionFileCreator.integration.test.ts src/main/__tests__/folderAccessManager.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: PASS。続けて `npm run typecheck`、変えたファイルへ eslint

---

### Task 3: preload と renderer の API の包み

**Files:**
- Modify: `src/preload/api.ts`(`createFile` の近く)
- Modify: `src/preload/index.d.ts`(`createFile(...)` の近く。import に型を足す)
- Create: `src/renderer/src/lib/agentInstructionsApi.ts`
- Modify: `src/renderer/src/__tests__/setup.ts`(`createFile` の次)
- Test: `src/preload/__tests__/api.test.ts`(`invokeCases` に追記)

**Interfaces:**
- Consumes: Task 1 の型
- Produces: `window.api.createAgentInstructionFile(cliKind: AgentCliKind, fileId: AgentInstructionFileId): Promise<AgentInstructionCreateResult>`、`agentInstructionsApi.createAgentInstructionFile(同じ引数)`

- [ ] **Step 1: 失敗するテストを書く**

`src/preload/__tests__/api.test.ts` の `invokeCases` の `createFile` の項目の次に足す:

```ts
  [
    'createAgentInstructionFile は agentInstructions:create チャンネルに cliKind と fileId を渡す',
    () => api.createAgentInstructionFile('claude', 'claude-dot'),
    ['agentInstructions:create', 'claude', 'claude-dot']
  ],
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/preload/__tests__/api.test.ts`
Expected: FAIL(`api.createAgentInstructionFile is not a function`。型エラーでもよい)

- [ ] **Step 3: 実装する**

`src/preload/api.ts`(import に `AgentInstructionCreateResult` を `@shared/types` から、`AgentInstructionFileId` を `@shared/agentInstructionFiles` から `import type` で足す):

```ts
  createAgentInstructionFile: (
    cliKind: AgentCliKind,
    fileId: AgentInstructionFileId
  ): Promise<AgentInstructionCreateResult> =>
    ipcRenderer.invoke('agentInstructions:create', cliKind, fileId),
```

`src/preload/index.d.ts`(同じ型を import に足す):

```ts
      /** 指示ファイルを表の雛形で作る(agentInstructions:create)。パスと中身は main が表から決める。失敗は理由で返す */
      createAgentInstructionFile(
        cliKind: AgentCliKind,
        fileId: AgentInstructionFileId
      ): Promise<AgentInstructionCreateResult>
```

```ts
// src/renderer/src/lib/agentInstructionsApi.ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFileId } from '@shared/agentInstructionFiles'
import type { AgentInstructionCreateResult } from '@shared/types'

export function createAgentInstructionFile(
  cliKind: AgentCliKind,
  fileId: AgentInstructionFileId
): Promise<AgentInstructionCreateResult> {
  return window.api.createAgentInstructionFile(cliKind, fileId)
}
```

`src/renderer/src/__tests__/setup.ts` の `createFile: () => Promise.resolve(),` の次に:

```ts
    createAgentInstructionFile: () => Promise.resolve({ ok: true }),
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/preload/__tests__/api.test.ts`
Expected: PASS。続けて `npm run typecheck`

---

### Task 4: ツリーのたどり・文言・作成の手順(renderer)と `useFileTreeOperations`・`useFileSystem`

**Files:**
- Create: `src/renderer/src/lib/agentInstructionFileLookup.ts`
- Create: `src/renderer/src/lib/agentInstructionMessages.ts`
- Create: `src/renderer/src/hooks/agentInstructionFileCreation.ts`
- Modify: `src/renderer/src/hooks/useFileTreeOperations.ts`(`refreshTree` の分割、戻り値の追加)
- Modify: `src/renderer/src/hooks/useFileSystem.ts`(インターフェース・分割代入・戻り値)
- Test: `src/renderer/src/lib/__tests__/agentInstructionFileLookup.test.ts`
- Test: `src/renderer/src/hooks/__tests__/agentInstructionFileCreation.test.ts`
- Test: `src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`(追記)

**Interfaces:**
- Consumes: Task 1・3
- Produces:
  - `findAgentInstructionFileNode(tree: readonly FileTreeNode[], segments: readonly string[]): FileTreeNode | null`
  - `agentInstructionCreateFailureMessage(reason: AgentInstructionCreateFailureReason): string`
  - `AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED: string`
  - `type AgentInstructionCreateOutcome = { status: 'created'; tree: FileTreeNode[] | null } | { status: 'failed'; reason: AgentInstructionCreateFailureReason } | { status: 'skipped' }`
  - `interface AgentInstructionFileCreationDeps { getFolderPath; lockPathForFileOperation; reloadTree }`
  - `runAgentInstructionFileCreation(deps, cliKind: AgentCliKind, file: AgentInstructionFile): Promise<AgentInstructionCreateOutcome>`
  - `useFileTreeOperations` と `useFileSystem` の戻り値に `createAgentInstructionFile: (cliKind: AgentCliKind, file: AgentInstructionFile) => Promise<AgentInstructionCreateOutcome>`

- [ ] **Step 1: たどる関数の失敗するテストを書く**

```ts
// src/renderer/src/lib/__tests__/agentInstructionFileLookup.test.ts
import { describe, expect, it } from 'vitest'
import type { FileTreeNode } from '../../types'
import { findAgentInstructionFileNode } from '../agentInstructionFileLookup'

const tree: FileTreeNode[] = [
  {
    name: '.claude',
    path: '/p/.claude',
    type: 'directory',
    children: [{ name: 'CLAUDE.md', path: '/p/.claude/CLAUDE.md', type: 'file' }]
  },
  { name: '.github', path: '/p/.github', type: 'file' },
  { name: 'AGENTS.md', path: '/p/AGENTS.md', type: 'directory', children: [] },
  { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' },
  { name: 'claude.local.md', path: '/p/claude.local.md', type: 'file' }
]

describe('findAgentInstructionFileNode', () => {
  it('根のファイル → そのノード', () => {
    expect(findAgentInstructionFileNode(tree, ['CLAUDE.md'])?.path).toBe('/p/CLAUDE.md')
  })

  it('入れ子のファイル → そのノード', () => {
    expect(findAgentInstructionFileNode(tree, ['.claude', 'CLAUDE.md'])?.path).toBe(
      '/p/.claude/CLAUDE.md'
    )
  })

  it('同じ名前のフォルダ → null', () => {
    expect(findAgentInstructionFileNode(tree, ['AGENTS.md'])).toBeNull()
  })

  it('途中がファイル → null', () => {
    expect(findAgentInstructionFileNode(tree, ['.github', 'copilot-instructions.md'])).toBeNull()
  })

  it('大文字小文字だけ違う → null(完全一致。L-009)', () => {
    expect(findAgentInstructionFileNode(tree, ['CLAUDE.local.md'])).toBeNull()
  })

  it('空のツリー → null', () => {
    expect(findAgentInstructionFileNode([], ['CLAUDE.md'])).toBeNull()
  })

  it('children の無いフォルダ → null', () => {
    const noChildren: FileTreeNode[] = [{ name: '.claude', path: '/p/.claude', type: 'directory' }]
    expect(findAgentInstructionFileNode(noChildren, ['.claude', 'CLAUDE.md'])).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentInstructionFileLookup.test.ts`
Expected: FAIL

- [ ] **Step 3: たどる関数と文言を実装する**

```ts
// src/renderer/src/lib/agentInstructionFileLookup.ts
// 指示ファイルの有無の判定(設計書 2026-11-05「有無の判定」)。パスの文字列ではなく名前で根からたどる
// (renderer の folderPath と main の realpath 済みの許可フォルダの書き方が違いうるため)。名前は完全一致(L-009)
import type { FileTreeNode } from '../types'
import { isFileNode } from './fileUtils'

export function findAgentInstructionFileNode(
  tree: readonly FileTreeNode[],
  segments: readonly string[]
): FileTreeNode | null {
  let level: readonly FileTreeNode[] = tree
  for (let index = 0; index < segments.length; index += 1) {
    const node = level.find((candidate) => candidate.name === segments[index])
    if (node === undefined) return null
    if (index === segments.length - 1) return isFileNode(node) ? node : null
    if (node.type !== 'directory') return null
    level = node.children ?? []
  }
  return null
}
```

```ts
// src/renderer/src/lib/agentInstructionMessages.ts
// 指示ファイルの節の固定の文言(設計書 2026-11-05)。main の例外の文言は画面に出さない(L-017)
import type { AgentInstructionCreateFailureReason } from '@shared/types'

const FAILURE_MESSAGES: Record<AgentInstructionCreateFailureReason, string> = {
  exists:
    '同じ名前のファイルかフォルダが既にあります(大文字と小文字だけ違う名前を含みます)。ファイルツリーを確かめてください',
  outside: 'フォルダの外には作成できません',
  failed: '指示ファイルを作成できませんでした'
}

export function agentInstructionCreateFailureMessage(
  reason: AgentInstructionCreateFailureReason
): string {
  return FAILURE_MESSAGES[reason]
}

export const AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED =
  '作成しましたが、開けませんでした。ファイルツリーから開いてください'
```

Run: `npx vitest run src/renderer/src/lib/__tests__/agentInstructionFileLookup.test.ts`
Expected: PASS

- [ ] **Step 4: 作成の手順の失敗するテストを書く**

```ts
// src/renderer/src/hooks/__tests__/agentInstructionFileCreation.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '../../types'
import { AGENT_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'

vi.mock('../../lib/agentInstructionsApi')

import * as agentInstructionsApi from '../../lib/agentInstructionsApi'
import { runAgentInstructionFileCreation } from '../agentInstructionFileCreation'
import type { AgentInstructionFileCreationDeps } from '../agentInstructionFileCreation'
import { SAVE_ABORTED_BY_CREATE } from '../useFileEditing'

const mockCreate = vi.mocked(agentInstructionsApi.createAgentInstructionFile)
const dotFile = AGENT_INSTRUCTION_FILES.claude[1] // .claude/CLAUDE.md
const tree: FileTreeNode[] = [{ name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }]

interface Harness {
  deps: AgentInstructionFileCreationDeps
  release: ReturnType<typeof vi.fn>
  setFolder: (folder: string | null) => void
}

const makeDeps = (reloadTree: () => Promise<FileTreeNode[] | null> = async () => tree): Harness => {
  let folder: string | null = '/p'
  const release = vi.fn()
  const deps: AgentInstructionFileCreationDeps = {
    getFolderPath: () => folder,
    lockPathForFileOperation: vi.fn(async () => release),
    reloadTree: vi.fn(reloadTree)
  }
  return { deps, release, setFolder: (next) => (folder = next) }
}

describe('runAgentInstructionFileCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('フォルダの根をロックし、作るファイルのパスを SAVE_ABORTED_BY_CREATE で無効にする', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps } = makeDeps()
    await runAgentInstructionFileCreation(deps, 'claude', dotFile)
    expect(deps.lockPathForFileOperation).toHaveBeenCalledWith('/p', {
      invalidatesPaths: ['/p/.claude/CLAUDE.md'],
      abortMessage: SAVE_ABORTED_BY_CREATE
    })
    expect(mockCreate).toHaveBeenCalledWith('claude', 'claude-dot')
  })

  it('成功 → ロックを成功で解放し、読み直したツリーを返す', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps, release } = makeDeps()
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'created',
      tree
    })
    expect(release).toHaveBeenCalledWith({ succeeded: true })
  })

  it('読み直しが反映されない → tree: null', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps } = makeDeps(async () => null)
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'created',
      tree: null
    })
  })

  it('読み直しが失敗 → 投げずに tree: null(作成の成功を失敗にしない。L-001)', async () => {
    mockCreate.mockResolvedValue({ ok: true })
    const { deps } = makeDeps(async () => {
      throw new Error('read failed')
    })
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'created',
      tree: null
    })
  })

  it('{ ok: false } → 失敗で解放し、理由を返し、読み直さない', async () => {
    mockCreate.mockResolvedValue({ ok: false, reason: 'exists' })
    const { deps, release } = makeDeps()
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'failed',
      reason: 'exists'
    })
    expect(release).toHaveBeenCalledWith({ succeeded: false })
    expect(deps.reloadTree).not.toHaveBeenCalled()
  })

  it('IPC が拒否 → 失敗で解放し、failed を返す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockCreate.mockRejectedValue(new Error('ipc'))
      const { deps, release } = makeDeps()
      await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
        status: 'failed',
        reason: 'failed'
      })
      expect(release).toHaveBeenCalledWith({ succeeded: false })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('フォルダが無い → skipped で、ロックも IPC も呼ばない', async () => {
    const { deps, setFolder } = makeDeps()
    setFolder(null)
    await expect(runAgentInstructionFileCreation(deps, 'claude', dotFile)).resolves.toEqual({
      status: 'skipped'
    })
    expect(deps.lockPathForFileOperation).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('作成の途中でフォルダが切り替わる → skipped で、読み直さない', async () => {
    const harness = makeDeps()
    mockCreate.mockImplementation(async () => {
      harness.setFolder('/other')
      return { ok: false, reason: 'exists' }
    })
    await expect(
      runAgentInstructionFileCreation(harness.deps, 'claude', dotFile)
    ).resolves.toEqual({ status: 'skipped' })
    expect(harness.deps.reloadTree).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/agentInstructionFileCreation.test.ts`
Expected: FAIL

- [ ] **Step 6: 作成の手順を実装する**

```ts
// src/renderer/src/hooks/agentInstructionFileCreation.ts
// 指示ファイルの作成の手順(設計書 2026-11-05「ファイルツリーの操作」)。既存の作成(createFile)と同じロックを通し、成否を結果で返す。
// 共有の error(エクスプローラーの上部)には書かない。失敗の文言は節だけに出す
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type { AgentInstructionCreateFailureReason, AgentInstructionCreateResult } from '@shared/types'
import type { FileTreeNode } from '../types'
import * as agentInstructionsApi from '../lib/agentInstructionsApi'
import { isSamePath, joinPath } from '../lib/pathUtils'
import { SAVE_ABORTED_BY_CREATE } from './useFileEditing'
import type { FileOperationLockOptions, FileOperationResult } from './useFileEditing'

export type AgentInstructionCreateOutcome =
  /** tree は読み直して反映したツリー。読み直せなかった・反映しなかったら null */
  | { status: 'created'; tree: FileTreeNode[] | null }
  | { status: 'failed'; reason: AgentInstructionCreateFailureReason }
  /** フォルダが無い・操作の途中でフォルダが切り替わった */
  | { status: 'skipped' }

export interface AgentInstructionFileCreationDeps {
  getFolderPath: () => string | null
  lockPathForFileOperation: (
    targetPath: string,
    options?: FileOperationLockOptions
  ) => Promise<(result?: FileOperationResult) => void>
  /** 反映したツリー、反映しなかったら null。読み込みの失敗は投げる(useFileTreeOperations の reloadTree) */
  reloadTree: () => Promise<FileTreeNode[] | null>
}

export async function runAgentInstructionFileCreation(
  deps: AgentInstructionFileCreationDeps,
  cliKind: AgentCliKind,
  file: AgentInstructionFile
): Promise<AgentInstructionCreateOutcome> {
  const folderAtStart = deps.getFolderPath()
  if (folderAtStart === null) return { status: 'skipped' }
  const isSameFolderNow = (): boolean => {
    const now = deps.getFolderPath()
    return now !== null && isSamePath(now, folderAtStart)
  }
  const targetPath = file.segments.reduce<string>(
    (parent, name) => joinPath(parent, name),
    folderAtStart
  )
  // ロックの対象は根(.claude はまだ無いことがある)。削除してバッファだけ残した同じパスのファイルを、古いバッファで上書きしない(L-061)
  const release = await deps.lockPathForFileOperation(folderAtStart, {
    invalidatesPaths: [targetPath],
    abortMessage: SAVE_ABORTED_BY_CREATE
  })
  let result: AgentInstructionCreateResult
  try {
    result = await agentInstructionsApi.createAgentInstructionFile(cliKind, file.id)
  } catch (err) {
    release({ succeeded: false })
    console.error('[createAgentInstructionFile] failed:', err)
    return isSameFolderNow() ? { status: 'failed', reason: 'failed' } : { status: 'skipped' }
  }
  release({ succeeded: result.ok })
  if (!isSameFolderNow()) return { status: 'skipped' }
  if (!result.ok) return { status: 'failed', reason: result.reason }
  try {
    return { status: 'created', tree: await deps.reloadTree() }
  } catch {
    // 読み直しの失敗の表示は reportTreeLoad が済ませている。作成の成功を失敗と取り違えない(L-001)
    return { status: 'created', tree: null }
  }
}
```

Run: `npx vitest run src/renderer/src/hooks/__tests__/agentInstructionFileCreation.test.ts`
Expected: PASS

- [ ] **Step 7: `useFileTreeOperations` の失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts` に追記する(`vi.mock('../../lib/agentInstructionsApi')` と import を先頭のモックの並びに足す。`renderOperations` は既存のもの):

```ts
describe('createAgentInstructionFile', () => {
  const rootFile = AGENT_INSTRUCTION_FILES.claude[0] // CLAUDE.md
  const created: FileTreeNode[] = [{ name: 'CLAUDE.md', path: '/project/CLAUDE.md', type: 'file' }]

  it('成功 → ツリーを読み直して反映し、そのツリーを返す。共有の error は null のまま', async () => {
    vi.mocked(agentInstructionsApi.createAgentInstructionFile).mockResolvedValue({ ok: true })
    mockReadDirectory.mockResolvedValue(created)
    const { result } = renderOperations()
    let outcome: unknown = null
    await act(async () => {
      outcome = await result.current.createAgentInstructionFile('claude', rootFile)
    })
    expect(outcome).toEqual({ status: 'created', tree: created })
    expect(result.current.fileTree).toEqual(created)
    expect(result.current.error).toBeNull()
  })

  it('{ ok: false } → failed を返し、共有の error に書かない', async () => {
    vi.mocked(agentInstructionsApi.createAgentInstructionFile).mockResolvedValue({
      ok: false,
      reason: 'exists'
    })
    const { result } = renderOperations()
    let outcome: unknown = null
    await act(async () => {
      outcome = await result.current.createAgentInstructionFile('claude', rootFile)
    })
    expect(outcome).toEqual({ status: 'failed', reason: 'exists' })
    expect(result.current.error).toBeNull()
    expect(mockReadDirectory).not.toHaveBeenCalled()
  })

  it('読み直しの失敗 → tree: null を返す(refreshTree の失敗は従来どおり投げる)', async () => {
    vi.mocked(agentInstructionsApi.createAgentInstructionFile).mockResolvedValue({ ok: true })
    mockReadDirectory.mockRejectedValue(new Error('read failed'))
    const { result } = renderOperations()
    let outcome: unknown = null
    await act(async () => {
      outcome = await result.current.createAgentInstructionFile('claude', rootFile)
    })
    expect(outcome).toEqual({ status: 'created', tree: null })
    let caught: unknown = null
    await act(async () => {
      try {
        await result.current.refreshTree()
      } catch (err) {
        caught = err
      }
    })
    expect(caught).toBeInstanceOf(Error)
  })
})
```

(この describe はファイルの末尾に足す。`mockReadDirectory.mockRejectedValue(...)` の実装は `vi.clearAllMocks()` では消えないため、後ろのテストに漏らさない。import に `import * as agentInstructionsApi from '../../lib/agentInstructionsApi'` と `import { AGENT_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'` を足す。各テストの前に `vi.clearAllMocks()` が既存の `beforeEach` で呼ばれているか確かめ、無ければ describe に `beforeEach(() => vi.clearAllMocks())` を置く)

- [ ] **Step 8: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`
Expected: FAIL(`createAgentInstructionFile is not a function`)

- [ ] **Step 9: `useFileTreeOperations` と `useFileSystem` を変える**

`useFileTreeOperations.ts`:

1. import に足す:

```ts
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import { runAgentInstructionFileCreation } from './agentInstructionFileCreation'
import type { AgentInstructionCreateOutcome } from './agentInstructionFileCreation'
```

2. `FileTreeOperationsState` に足す:

```ts
  /** 指示ファイルを表の雛形で作ってツリーを読み直す。成否は結果で返し、共有の error には書かない(設計書 2026-11-05) */
  createAgentInstructionFile: (
    cliKind: AgentCliKind,
    file: AgentInstructionFile
  ) => Promise<AgentInstructionCreateOutcome>
```

3. 今の `refreshTree` を次の 2 つに置き換える(中身の判定と文言は今のまま):

```ts
  // ツリーを読み直して反映する。反映したらそのツリー、反映しなかった(走査中・古い結果・フォルダが無い)ら null。
  // 読み込みの失敗は reportTreeLoad の後に投げ直す(refreshTree と指示ファイルの作成が使う)
  const reloadTree = async (): Promise<FileTreeNode[] | null> => {
    const isLatestWrite = beginTreeWrite()
    if (isLatestWrite === null) return null
    const target = getFolderPath()
    if (target === null) return null
    const isStale = (): boolean => !isLatestWrite() || getFolderPath() !== target
    try {
      const tree = await fileSystemApi.readDirectory(target)
      if (isStale()) return null
      setFileTree(tree)
      reportTreeLoad(null)
      return tree
    } catch (err) {
      if (isStale()) return null
      reportTreeLoad(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  const refreshTree = async (): Promise<boolean> => (await reloadTree()) !== null
```

(今の `refreshTree` にある説明のコメントは `reloadTree` の中の同じ行へ移す)

4. 戻り値の前に:

```ts
  const createAgentInstructionFile = (
    cliKind: AgentCliKind,
    file: AgentInstructionFile
  ): Promise<AgentInstructionCreateOutcome> =>
    runAgentInstructionFileCreation(
      { getFolderPath, lockPathForFileOperation, reloadTree },
      cliKind,
      file
    )
```

戻り値のオブジェクトに `createAgentInstructionFile,` を足す。

`useFileSystem.ts`: インターフェース(`createFile: ...` の近く)に同じシグネチャの `createAgentInstructionFile` を足し(型の import も足す)、`useFileTreeOperations` の分割代入と戻り値に `createAgentInstructionFile` を足す。

- [ ] **Step 10: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts src/renderer/src/hooks/__tests__/agentInstructionFileCreation.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts`
Expected: PASS。続けて `npm run typecheck`、変えたファイルへ eslint

---

### Task 5: 節の状態の hook と `useAppState` の配線

**Files:**
- Modify: `src/renderer/src/types.ts`(`CloneRepositoryPanelState` の近く)
- Create: `src/renderer/src/hooks/useAgentInstructionFiles.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Create: `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`

**Interfaces:**
- Consumes: Task 1・4
- Produces:
  - `interface AgentInstructionFileRow { file: AgentInstructionFile; relativePath: string; node: FileTreeNode | null }`
  - `interface AgentInstructionsPanelState { cliKind: AgentCliKind; rows: readonly AgentInstructionFileRow[]; isCreating: boolean; message: string | null; open: (row: AgentInstructionFileRow) => void; create: (row: AgentInstructionFileRow) => Promise<void> }`
  - `useAgentInstructionFiles(options: UseAgentInstructionFilesOptions): AgentInstructionsPanelState`
  - `useAppState()` の戻り値に `agentInstructions: AgentInstructionsPanelState`
  - `makeAgentInstructionsPanelState(overrides?: Partial<AgentInstructionsPanelState>): AgentInstructionsPanelState`

- [ ] **Step 1: 型を足す**

`src/renderer/src/types.ts`(`import type` を足す: `AgentInstructionFile` from `@shared/agentInstructionFiles`。`AgentCliKind` と `FileTreeNode` は既にあれば再利用):

```ts
/** 指示ファイルの節の 1 行。node はツリーで見つかったファイル(無ければ null) */
export interface AgentInstructionFileRow {
  file: AgentInstructionFile
  /** 一覧と aria-label に出す相対パス(区切りは /) */
  relativePath: string
  node: FileTreeNode | null
}

/** エクスプローラーの「エージェントの指示ファイル」の節の状態と操作(設計書 2026-11-05) */
export interface AgentInstructionsPanelState {
  /** 一覧の CLI(設定の種類。読み込み中は既定の claude) */
  cliKind: AgentCliKind
  rows: readonly AgentInstructionFileRow[]
  /** 作成の途中。節のボタンをすべて disabled にする */
  isCreating: boolean
  /** 失敗の固定の文言。次の操作で消える */
  message: string | null
  /** ファイルがある行を開く(エクスプローラーでファイルを選んだときと同じ経路) */
  open: (row: AgentInstructionFileRow) => void
  /** 無い行を雛形で作って開く */
  create: (row: AgentInstructionFileRow) => Promise<void>
}
```

```ts
// src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts
import { vi } from 'vitest'
import { AGENT_INSTRUCTION_FILES, agentInstructionRelativePath } from '@shared/agentInstructionFiles'
import type { AgentInstructionsPanelState } from '../types'

/** テスト用の指示ファイルの節の状態。既定は claude の 3 行がすべて無い・作成中でない・文言なし */
export const makeAgentInstructionsPanelState = (
  overrides: Partial<AgentInstructionsPanelState> = {}
): AgentInstructionsPanelState => ({
  cliKind: 'claude',
  rows: AGENT_INSTRUCTION_FILES.claude.map((file) => ({
    file,
    relativePath: agentInstructionRelativePath(file),
    node: null
  })),
  isCreating: false,
  message: null,
  open: vi.fn<AgentInstructionsPanelState['open']>(),
  create: vi.fn<AgentInstructionsPanelState['create']>().mockResolvedValue(undefined),
  ...overrides
})
```

- [ ] **Step 2: hook の失敗するテストを書く**

```ts
// src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '../../types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { useAgentInstructionFiles } from '../useAgentInstructionFiles'
import type { UseAgentInstructionFilesOptions } from '../useAgentInstructionFiles'
import type { AgentInstructionCreateOutcome } from '../agentInstructionFileCreation'
import {
  AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  agentInstructionCreateFailureMessage
} from '../../lib/agentInstructionMessages'

const claudeNode: FileTreeNode = { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }

const renderFiles = (
  overrides: Partial<UseAgentInstructionFilesOptions> = {}
): ReturnType<typeof renderHook<ReturnType<typeof useAgentInstructionFiles>, UseAgentInstructionFilesOptions>> => {
  const initialProps: UseAgentInstructionFilesOptions = {
    folderPath: '/p',
    fileTree: [],
    cliKind: 'claude',
    createFile: vi.fn<UseAgentInstructionFilesOptions['createFile']>(),
    openFile: vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true),
    ...overrides
  }
  return renderHook((props) => useAgentInstructionFiles(props), { initialProps })
}

describe('useAgentInstructionFiles', () => {
  it('claude → 3 行。ツリーにある行だけ node が入る', () => {
    const { result } = renderFiles({ fileTree: [claudeNode] })
    expect(result.current.rows.map((r) => r.relativePath)).toEqual([
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'CLAUDE.local.md'
    ])
    expect(result.current.rows[0].node).toBe(claudeNode)
    expect(result.current.rows[1].node).toBeNull()
  })

  it('CLI を copilot に切り替える → copilot の 2 行に変わる', () => {
    const { result, rerender } = renderFiles()
    rerender({
      folderPath: '/p',
      fileTree: [],
      cliKind: 'copilot' as AgentCliKind,
      createFile: vi.fn(),
      openFile: vi.fn()
    })
    expect(result.current.cliKind).toBe('copilot')
    expect(result.current.rows.map((r) => r.relativePath)).toEqual([
      'AGENTS.md',
      '.github/copilot-instructions.md'
    ])
  })

  it('open → その node で openFile を呼ぶ', () => {
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({ fileTree: [claudeNode], openFile })
    act(() => result.current.open(result.current.rows[0]))
    expect(openFile).toHaveBeenCalledWith(claudeNode)
  })

  it('create の成功 → 読み直したツリーのノードを開く', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'created', tree: [claudeNode] })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(createFile).toHaveBeenCalledWith('claude', result.current.rows[0].file)
    expect(openFile).toHaveBeenCalledWith(claudeNode)
    expect(result.current.message).toBeNull()
    expect(result.current.isCreating).toBe(false)
  })

  it.each<[string, AgentInstructionCreateOutcome]>([
    ['tree が null', { status: 'created', tree: null }],
    ['ノードが見つからない', { status: 'created', tree: [] }]
  ])('create の後に %s → 開けなかった文言を出し、開かない', async (_label, outcome) => {
    const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>().mockResolvedValue(outcome)
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(result.current.message).toBe(AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
    expect(openFile).not.toHaveBeenCalled()
  })

  it('create の失敗 → 理由の文言を出し、開かない', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'outside' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[1])
    })
    expect(result.current.message).toBe(agentInstructionCreateFailureMessage('outside'))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('create が skipped → 文言を出さない', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'skipped' })
    const { result } = renderFiles({ createFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    expect(result.current.message).toBeNull()
  })

  it('作成の途中の 2 回目の create → 無視する(ref で判定。L-653)', async () => {
    let resolveCreate: (outcome: AgentInstructionCreateOutcome) => void = () => {}
    const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
      () => new Promise((resolve) => (resolveCreate = resolve))
    )
    const { result } = renderFiles({ createFile })
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.create(result.current.rows[0])
      void result.current.create(result.current.rows[1])
    })
    expect(createFile).toHaveBeenCalledTimes(1)
    expect(result.current.isCreating).toBe(true)
    await act(async () => {
      resolveCreate({ status: 'skipped' })
      await first
    })
    expect(result.current.isCreating).toBe(false)
  })

  it('次の操作で文言を消す', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'exists' })
    const { result } = renderFiles({ createFile, fileTree: [claudeNode] })
    await act(async () => {
      await result.current.create(result.current.rows[1])
    })
    expect(result.current.message).not.toBeNull()
    act(() => result.current.open(result.current.rows[0]))
    expect(result.current.message).toBeNull()
  })

  it('フォルダが切り替わる → 文言を消す', async () => {
    const createFile = vi
      .fn<UseAgentInstructionFilesOptions['createFile']>()
      .mockResolvedValue({ status: 'failed', reason: 'exists' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result, rerender } = renderFiles({ createFile, openFile })
    await act(async () => {
      await result.current.create(result.current.rows[0])
    })
    rerender({ folderPath: '/q', fileTree: [], cliKind: 'claude', createFile, openFile })
    expect(result.current.message).toBeNull()
  })

  it('createFile が拒否 → failed の文言を出し、作成中を戻す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const createFile = vi
        .fn<UseAgentInstructionFilesOptions['createFile']>()
        .mockRejectedValue(new Error('boom'))
      const { result } = renderFiles({ createFile })
      await act(async () => {
        await result.current.create(result.current.rows[0])
      })
      expect(result.current.message).toBe(agentInstructionCreateFailureMessage('failed'))
      expect(result.current.isCreating).toBe(false)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
```

(`renderFiles` の戻り値の型の注釈が長ければ、`function renderFiles(...)` にして戻り値の型を `RenderHookResult<AgentInstructionsPanelState, UseAgentInstructionFilesOptions>`(`@testing-library/react` から `import type`)にする)

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: FAIL

- [ ] **Step 4: hook を実装する**

```ts
// src/renderer/src/hooks/useAgentInstructionFiles.ts
// エクスプローラーの「エージェントの指示ファイル」の節の状態(設計書 2026-11-05「renderer の流れ」)。CLI の種類は useAgentWorkspace の
// appCliKind を受け取る(この hook の中で useAgentCliKind を呼び直さない。L-466)
import { useRef, useState } from 'react'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_INSTRUCTION_FILES, agentInstructionRelativePath } from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type { AgentInstructionFileRow, AgentInstructionsPanelState, FileTreeNode } from '../types'
import { findAgentInstructionFileNode } from '../lib/agentInstructionFileLookup'
import {
  AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  agentInstructionCreateFailureMessage
} from '../lib/agentInstructionMessages'
import type { AgentInstructionCreateOutcome } from './agentInstructionFileCreation'
import { useOnChange } from './useOnChange'

export interface UseAgentInstructionFilesOptions {
  folderPath: string | null
  fileTree: FileTreeNode[]
  cliKind: AgentCliKind
  /** useAppState の包んだもの(作成の後に git の状態も取り直す) */
  createFile: (cliKind: AgentCliKind, file: AgentInstructionFile) => Promise<AgentInstructionCreateOutcome>
  /** useAppState の selectFile(diff タブを非アクティブにする処理と、破棄の確認が付く) */
  openFile: (node: FileTreeNode) => Promise<boolean>
}

export function useAgentInstructionFiles({
  folderPath,
  fileTree,
  cliKind,
  createFile,
  openFile
}: UseAgentInstructionFilesOptions): AgentInstructionsPanelState {
  const [isCreating, setIsCreating] = useState(false)
  // 押せるかは ref で判定する(state の反映を待つと連打で 2 回作る。L-653)
  const creatingRef = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  // 前のフォルダの失敗の文言を、新しいフォルダの節に残さない
  useOnChange(folderPath, () => setMessage(null))

  const rows: AgentInstructionFileRow[] = AGENT_INSTRUCTION_FILES[cliKind].map((file) => ({
    file,
    relativePath: agentInstructionRelativePath(file),
    node: findAgentInstructionFileNode(fileTree, file.segments)
  }))

  const open = (row: AgentInstructionFileRow): void => {
    if (creatingRef.current || row.node === null) return
    setMessage(null)
    void openFile(row.node)
  }

  const create = async (row: AgentInstructionFileRow): Promise<void> => {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    setMessage(null)
    try {
      const outcome = await createFile(cliKind, row.file)
      if (outcome.status === 'skipped') return
      if (outcome.status === 'failed') {
        setMessage(agentInstructionCreateFailureMessage(outcome.reason))
        return
      }
      const node =
        outcome.tree === null ? null : findAgentInstructionFileNode(outcome.tree, row.file.segments)
      if (node === null) {
        setMessage(AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
        return
      }
      await openFile(node)
    } catch (err) {
      console.error('[useAgentInstructionFiles] create failed:', err)
      setMessage(agentInstructionCreateFailureMessage('failed'))
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  return { cliKind, rows, isCreating, message, open, create }
}
```

注意: `openFile` が拒否した場合(読み込みの失敗)は、`fileSystem.selectFile` が自分でエクスプローラーの上部のエラーに出すので、ここで「作成できませんでした」と言い換えない。`selectFile` が拒否しない(false を返す)ことを `useFileSystem.ts` の `selectFile` で確かめ、拒否しうるなら `await openFile(node)` を `try { await openFile(node) } catch (err) { console.error(...) }` で包んで文言を出さない。

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: PASS

- [ ] **Step 5: `useAppState` に配線する**

`src/renderer/src/hooks/useAppState.ts`:

1. import: `import { useAgentInstructionFiles } from './useAgentInstructionFiles'`、`import type { AgentInstructionsPanelState } from '../types'`(既存の types の import に足す)
2. 戻り値の型(`clone: CloneRepositoryPanelState` の次)に:

```ts
  /** エクスプローラーの「エージェントの指示ファイル」の節の状態と操作 */
  agentInstructions: AgentInstructionsPanelState
```

3. `const createFile: typeof fileSystem.createFile = ...`(359 行付近)の近くに、`selectFile` と `agentWorkspace` の定義より後で:

```ts
  // 作成できたら git の状態も取り直す(新しい未追跡のファイル。createFile の包みと同じ)
  const createAgentInstructionFile: typeof fileSystem.createAgentInstructionFile = async (
    cliKind,
    file
  ) => {
    const outcome = await fileSystem.createAgentInstructionFile(cliKind, file)
    if (outcome.status === 'created') await git.refreshGitStatus()
    return outcome
  }
  const agentInstructions = useAgentInstructionFiles({
    folderPath: fileSystem.folderPath,
    fileTree: fileSystem.fileTree,
    cliKind: agentWorkspace.agentTerminal.appCliKind,
    createFile: createAgentInstructionFile,
    openFile: selectFile
  })
```

(hook の呼び出しは条件分岐の外に置く。`selectFile` の定義(309 行付近)より後ろであることを確かめる)

4. 戻り値のオブジェクトの `clone,` の次に `agentInstructions,` を足す。

`src/renderer/src/hooks/__tests__/useAppState.test.ts` に 1 件足す(既存の `renderHook(() => useAppState())` の流儀に合わせる):

```ts
  it('agentInstructions → 既定の claude の 3 行を出す', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current.agentInstructions.cliKind).toBe('claude')
    expect(result.current.agentInstructions.rows.map((r) => r.relativePath)).toEqual([
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'CLAUDE.local.md'
    ])
  })
```

配線の取り違えを検出するテスト(L-060・L-466)も `useAppState.test.ts` に足す。このファイルは `mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())`(303 行付近)で `useAgentWorkspace` を差し替え、`useFileSystem`・`useGitStatus`・`useDiffTabs` もモックしている(`refreshGitStatus: vi.fn()`・`deactivateDiffTab: vi.fn()` の並び)。既存の流儀に合わせて、次の 3 件を書く:

1. 設定の CLI の配線: `makeAgentWorkspaceState` の `agentTerminal` を上書きして `appCliKind: 'copilot'` にし(`makeAgentWorkspaceState` と `makeAgentTerminalPanelState` の引数の形を読んで合わせる)、`result.current.agentInstructions.rows.map((r) => r.relativePath)` が `['AGENTS.md', '.github/copilot-instructions.md']` になる
2. 開く経路の配線: `useFileSystem` のモックの `fileTree` に `{ name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }` を入れ、`selectFile` を `vi.fn().mockResolvedValue(true)` にする。`useDiffTabs` のモックは `mockReturnValue` で同じオブジェクトを返すようにして `deactivateDiffTab` の参照を控える(既定の実装はレンダーのたびに新しい `vi.fn()` を返すため)。`open` は `void openFile(node)` で、包んだ `selectFile` は `await` の後に `deactivateDiffTab` を呼ぶので、`await act(async () => { result.current.agentInstructions.open(result.current.agentInstructions.rows[0]) })` の後に `await waitFor(() => expect(deactivateDiffTab).toHaveBeenCalled())` で確かめる(生の `fileSystem.selectFile` に取り違えると呼ばれない)
3. 作成の後の git の再取得: `useFileSystem` のモックに `createAgentInstructionFile: vi.fn().mockResolvedValue({ status: 'created', tree: [CLAUDE.md のノード] })` を入れる。`useGitStatus` のモックも `mockReturnValue` で同じオブジェクトを返して `refreshGitStatus` の参照を控える。`create` の前の呼ばれた回数を控え、`await act(async () => { await result.current.agentInstructions.create(result.current.agentInstructions.rows[0]) })` の後に回数が 1 増える。`{ status: 'failed', reason: 'exists' }` のときは回数が増えない(`it.each`。マウント時の別の経路の呼び出しに左右されないよう、前後の差で比べる)

`mockUseFileSystem` は戻り値の型を明示した `vi.fn((): {...} => ...)` なので、その型の注釈に `createAgentInstructionFile?: (cliKind: AgentCliKind, file: AgentInstructionFile) => Promise<AgentInstructionCreateOutcome>` を足してから、既定の戻り値と各テストの上書きに入れる(足さないとオブジェクトのリテラルの余分な欄として型エラーになる)。

また、`useAppState` の戻り値は `...fileSystem` を展開しているので、生の `createAgentInstructionFile`(git の再取得なし)も公開される。`createFile` などと同じく、展開の後の差し替えの並び(`selectFile, activateTab, createFile, ...` のところ)に包んだ `createAgentInstructionFile,` を足して上書きする。

- [ ] **Step 6: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts`
Expected: PASS。続けて `npm run typecheck`(この時点では `App.tsx` が `agentInstructions` を使っていないだけで型エラーは出ない)、変えたファイルへ eslint

---

### Task 6: 節の表示と配線(ExplorerPanel・Sidebar・App)・スタイル

**Files:**
- Create: `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`
- Modify: `src/renderer/src/components/explorer/ExplorerPanel.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Test: `src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx`(新規)
- Test: `src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`・`ExplorerPanel.clone.test.tsx`・`ExplorerPanel.styles.test.tsx`・`src/renderer/src/components/__tests__/Sidebar.test.tsx`(既定の props に `agentInstructions: makeAgentInstructionsPanelState()` を足す)
- Test: `src/renderer/src/components/__tests__/App.agentInstructions.test.tsx`(新規。配線)

**Interfaces:**
- Consumes: Task 5 の `AgentInstructionsPanelState`・`makeAgentInstructionsPanelState`
- Produces: `ExplorerPanelProps.agentInstructions: AgentInstructionsPanelState`(必須。L-060)、`<AgentInstructionFilesSection state={...} isBlocked={boolean} />`

- [ ] **Step 1: 節の失敗するテストを書く**

```tsx
// src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AGENT_INSTRUCTION_FILES, agentInstructionRelativePath } from '@shared/agentInstructionFiles'
import AgentInstructionFilesSection from '../AgentInstructionFilesSection'
import { makeAgentInstructionsPanelState } from '../../../__tests__/makeAgentInstructionsPanelState'
import type { AgentInstructionFileRow } from '../../../types'

const claudeRows = (existing: string[]): AgentInstructionFileRow[] =>
  AGENT_INSTRUCTION_FILES.claude.map((file) => {
    const relativePath = agentInstructionRelativePath(file)
    return {
      file,
      relativePath,
      node: existing.includes(relativePath)
        ? { name: file.segments[file.segments.length - 1], path: `/p/${relativePath}`, type: 'file' }
        : null
    }
  })

describe('AgentInstructionFilesSection', () => {
  it('見出しに CLI の表示名を出す', () => {
    render(<AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />)
    expect(
      screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    ).toBeInTheDocument()
  })

  it('copilot → 見出しは GitHub Copilot CLI', () => {
    const rows = AGENT_INSTRUCTION_FILES.copilot.map((file) => ({
      file,
      relativePath: agentInstructionRelativePath(file),
      node: null
    }))
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ cliKind: 'copilot', rows })}
        isBlocked={false}
      />
    )
    expect(
      screen.getByRole('region', { name: 'エージェントの指示ファイル(GitHub Copilot CLI)' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AGENTS.md を作成' })).toBeInTheDocument()
  })

  it('ある行は 開く、無い行は 作成。行にパスと説明を出す', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })}
        isBlocked={false}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('CLAUDE.md')).toBeInTheDocument()
    expect(within(items[0]).getByText('共有の指示')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'CLAUDE.md を開く' })).toHaveTextContent('開く')
    expect(
      within(items[1]).getByRole('button', { name: '.claude/CLAUDE.md を作成' })
    ).toHaveTextContent('作成')
  })

  it('開く・作成 → state の open・create をその行で呼ぶ', async () => {
    const state = makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.md を開く' }))
    expect(state.open).toHaveBeenCalledWith(state.rows[0])
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.local.md を作成' }))
    expect(state.create).toHaveBeenCalledWith(state.rows[2])
  })

  it.each([
    ['作成中', { isCreating: true }, false],
    ['clone 中', {}, true]
  ])('%s → すべてのボタンが disabled', (_label, overrides, isBlocked) => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']), ...overrides })}
        isBlocked={isBlocked}
      />
    )
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('文言 → role=alert で出す。無ければ alert は無い', () => {
    const { rerender } = render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ message: 'フォルダの外には作成できません' })}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('フォルダの外には作成できません')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx`
Expected: FAIL

- [ ] **Step 3: 節を実装する**

```tsx
// src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx
// エクスプローラーの上部の「エージェントの指示ファイル」の節(設計書 2026-11-05「画面」)
import { useId } from 'react'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentInstructionsPanelState } from '../../types'

interface Props {
  state: AgentInstructionsPanelState
  /** clone の実行中など、フォルダが切り替わりうる間は押させない */
  isBlocked: boolean
}

export default function AgentInstructionFilesSection({ state, isBlocked }: Props): React.JSX.Element {
  const headingId = useId()
  const disabled = isBlocked || state.isCreating
  return (
    <section className="agent-instructions" aria-labelledby={headingId}>
      <h3 id={headingId} className="agent-instructions__title">
        エージェントの指示ファイル({AGENT_CLI_PROFILES[state.cliKind].displayName})
      </h3>
      <ul className="agent-instructions__list">
        {state.rows.map((row) => (
          <li key={row.file.id} className="agent-instructions__row">
            <span className="agent-instructions__text">
              <span className="agent-instructions__path">{row.relativePath}</span>
              <span className="agent-instructions__description">{row.file.description}</span>
            </span>
            {row.node !== null ? (
              <button
                type="button"
                className="agent-instructions__button"
                aria-label={`${row.relativePath} を開く`}
                disabled={disabled}
                onClick={() => state.open(row)}
              >
                開く
              </button>
            ) : (
              <button
                type="button"
                className="agent-instructions__button"
                aria-label={`${row.relativePath} を作成`}
                disabled={disabled}
                onClick={() => void state.create(row)}
              >
                作成
              </button>
            )}
          </li>
        ))}
      </ul>
      {state.message !== null && (
        <p role="alert" className="agent-instructions__message">
          {state.message}
        </p>
      )}
    </section>
  )
}
```

`src/renderer/src/assets/main.css` の `.explorer-panel__error { ... }` の次に:

```css
/* ---- エージェントの指示ファイル(エクスプローラーの上部の節) ---- */

.agent-instructions {
  margin: 0 12px 6px;
  padding: 6px 0;
  border-top: 1px solid #3c3c3c;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}

.agent-instructions__title {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: #bbbbbb;
}

.agent-instructions__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-instructions__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

/* 狭いサイドバー(220px)では説明を次の行へ折り返し、ボタンは右端に残す */
.agent-instructions__text {
  display: flex;
  flex-wrap: wrap;
  column-gap: 6px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
}

.agent-instructions__path {
  color: #cccccc;
  overflow-wrap: anywhere;
}

.agent-instructions__description {
  color: #969696;
}

.agent-instructions__message {
  margin: 4px 0 0;
  font-size: 12px;
  color: #f48771;
}
```

そして、共通の枠付きのボタンの 3 つのグループセレクタ(`.explorer-panel__clone-btn,` を含む、寸法・`:hover`・`:disabled` の 3 か所)のそれぞれで、`.explorer-panel__clone-btn` の次の行に `.agent-instructions__button` を足す(`:hover:not(:disabled)`・`:disabled` の形もそろえる)。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx`
Expected: PASS

- [ ] **Step 5: ExplorerPanel・Sidebar・App を配線する**

`ExplorerPanel.tsx`:
- `import type { AgentInstructionsPanelState, CloneRepositoryPanelState, FileTreeNode } from '../../types'`、`import AgentInstructionFilesSection from './AgentInstructionFilesSection'`
- `ExplorerPanelProps` に `/** 「エージェントの指示ファイル」の節(フォルダを開いているときだけ出す。省略できない。L-060) */ agentInstructions: AgentInstructionsPanelState` を足し、分割代入に `agentInstructions` を足す
- フォルダを開いている分岐の `<CloneRepositoryEntry clone={clone} />` の直後(ツリーの `<div role="tree"...>` の前)に:

```tsx
          <AgentInstructionFilesSection state={agentInstructions} isBlocked={clone.isCloning} />
```

(CloneRepositoryEntry を 2 番目に置く理由のコメントがあるので、節は 3 番目に置き、2 番目の位置を変えない)

`Sidebar.tsx`: 分割代入に `agentInstructions` を足し、`<ExplorerPanel ...>` に `agentInstructions={agentInstructions}` を渡す(`Props` は `ExplorerPanelProps` を継承しているので型は自動で入る)。

`App.tsx`: `useAppState()` の分割代入(`clone,` の近く)に `agentInstructions,` を足し、`<Sidebar ...>` の `clone={clone}` の次に `agentInstructions={agentInstructions}` を足す。

既存のテストの既定の props に足す(`import { makeAgentInstructionsPanelState } from '<相対パス>/__tests__/makeAgentInstructionsPanelState'`):
- `ExplorerPanel.test.tsx` の `defaultProps`、`ExplorerPanel.clone.test.tsx`・`ExplorerPanel.styles.test.tsx` の既定の props、`Sidebar.test.tsx` の `defaultProps` に `agentInstructions: makeAgentInstructionsPanelState()`
- ほかに `<ExplorerPanel` か `<Sidebar` を描くテストがあれば同じく足す(`grep -rln "<ExplorerPanel\|<Sidebar" src/renderer/src` で探す)

`ExplorerPanel.test.tsx` に 3 件足す(import に `within` を足す):

```tsx
  it('フォルダを開いている → 指示ファイルの節をツリーの前に出す', () => {
    render(<ExplorerPanel {...openedProps} />)
    const section = screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    const tree = screen.getByRole('tree')
    expect(section.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('clone の実行中 → 節のボタンがすべて disabled(isBlocked の配線)', () => {
    render(
      <ExplorerPanel
        {...openedProps}
        clone={makeCloneRepositoryPanelState({ isCloning: true })}
      />
    )
    const section = screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    for (const button of within(section).getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('フォルダを開いていない → 指示ファイルの節を出さない', () => {
    render(<ExplorerPanel {...defaultProps} />)
    expect(screen.queryByRole('region', { name: /エージェントの指示ファイル/ })).not.toBeInTheDocument()
  })
```

`ExplorerPanel.styles.test.tsx` に 1 件足す(同じファイルの既存の「32px 四方以上の枠付きボタン」のテストの書き方で、`agentInstructions__button` が `min-width: 32px`・`min-height: 32px`・`border: 1px solid` を持つことを確かめる。`folderPath: '/p'` で描き、`screen.getByRole('button', { name: 'CLAUDE.md を作成' })` の `getComputedStyle` を見る)。

- [ ] **Step 6: App の配線のテストを書く**

```tsx
// src/renderer/src/components/__tests__/App.agentInstructions.test.tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '@shared/types'

// jsdom では xterm を開けないため、App.agentReferences.test.tsx と同じく偽の controller にする
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'

// App → useAppState(useAgentInstructionFiles)→ Sidebar → ExplorerPanel → 節、の配線を、作成から開くまでで確かめる
const before: FileTreeNode[] = [{ name: 'notes.md', path: '/p/notes.md', type: 'file' }]
const after: FileTreeNode[] = [{ name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }, ...before]

describe('App: 指示ファイルの配線', () => {
  const original = { ...window.api }

  beforeEach(() => {
    window.api.openFolder = vi.fn().mockResolvedValue('/p')
    // 作成が呼ばれた後だけ CLAUDE.md を含むツリーを返す(読み込みの回数に頼らない)
    window.api.readDirectory = vi.fn(async () =>
      vi.mocked(window.api.createAgentInstructionFile).mock.calls.length > 0 ? after : before
    )
    window.api.readFile = vi.fn().mockResolvedValue('# プロジェクトの指示\n')
    window.api.createAgentInstructionFile = vi.fn().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    Object.assign(window.api, original)
  })

  it('作成 → main へ claude の id を送り、作ったファイルをタブで開く', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md を作成' }))
    expect(window.api.createAgentInstructionFile).toHaveBeenCalledWith('claude', 'claude-root')
    await waitFor(() => expect(window.api.readFile).toHaveBeenCalledWith('/p/CLAUDE.md'))
    expect(await screen.findByRole('button', { name: 'CLAUDE.md を開く' })).toBeInTheDocument()
  })

  it('作成の失敗 → 節に文言を出し、エクスプローラーの上部のエラーには出さない', async () => {
    window.api.createAgentInstructionFile = vi.fn().mockResolvedValue({ ok: false, reason: 'exists' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'CLAUDE.md を作成' }))
    const section = screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      '同じ名前のファイルかフォルダが既にあります'
    )
    expect(screen.queryByText(/指示ファイルを作成できませんでした|Error invoking/)).not.toBeInTheDocument()
    expect(window.api.readFile).not.toHaveBeenCalled()
  })
})
```

(`readFile` の呼ばれ方が `fs:readFile` 以外の経路(`readFileChecked` など)なら、`useFileSystem.ts` の `selectFile` が呼ぶ `fileSystemApi` の関数を確かめて、そのスタブに置き換える。`window.api.getAgentCliKind` の既定のスタブが `claude` を返すことを `setup.ts` で確かめる)

- [ ] **Step 7: 通ることを確かめる**

Run: `npx vitest run src/renderer/src/components`
Expected: PASS。続けて `npm run typecheck`、変えたファイルへ eslint

---

### Task 7: ROADMAP・文書・実機テスト仕様書の更新と全体の検証

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`(機能の一覧と「ディレクトリ構成と主要なモジュール」に該当の節があれば 1〜2 行)
- Modify: `docs/developer-guide.md`(3.4 の CLI ごとの表の列挙に `src/shared/agentInstructionFiles.ts` を足す)
- Modify: `docs/manual-test-spec.md`
- 生成: `.superpowers/manual-test-spec.html`(`node scripts/build-manual-test-spec.mjs`)

- [ ] **Step 1: ROADMAP を更新する**

1. 「今後実装した方がよい機能」の `- [ ] エージェント向けの指示ファイル（`CLAUDE.md` など）の編集支援` を `- [x]` にし、次の行に書き添える(既存の項目の「実装済み(日付。設計書 …)」の書き方に合わせる):

```markdown
      - 実装済み（2026-11-05。設計書 `docs/superpowers/specs/2026-11-05-agent-instruction-files-design.md`）: エクスプローラーの上部の「エージェントの指示ファイル」の節。選んでいる CLI の指示ファイル（claude: `CLAUDE.md`・`.claude/CLAUDE.md`・`CLAUDE.local.md`、copilot: `AGENTS.md`・`.github/copilot-instructions.md`）を一覧し、あれば開く、無ければ見出しだけの雛形で作って開く。残り: サブフォルダの指示ファイルの探索、利用者の全体の指示ファイル（`~/.claude/CLAUDE.md` など）、プロンプトの内容の追記、外部での追加・削除の自動の反映（file watcher）
```

2. 「実装済み機能」の最後の `###`(「copilot の hooks による利用者の変更との区別（段階 3b）」)の後、`## MVP:` の前に、同じ形の節を足す:

```markdown
### エージェント向けの指示ファイルの編集支援

- [x] エクスプローラーの上部の「エージェントの指示ファイル（<CLI の表示名>）」の節（フォルダを開いているときだけ。設定で選んでいる CLI の分だけを出す）
- [x] ファイルがあれば `開く`、無ければ `作成`（見出しだけの雛形を書いて開く。既にあるファイルは上書きしない。`.claude`・`.github` のフォルダも作る）
- [x] 作成の失敗は節の中に固定の文言で出す（同じ名前のもの・フォルダの外・それ以外）。パスは画面に出さない
```

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の `## エクスプローラー` の最後の項目(`EXP-073`)の後に、`### エージェントの指示ファイル` を足す。ID は `EXP-074` から(既存の最大は `EXP-073`。追記の前に `grep -o 'EXP-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1` で確かめ、違えばその次から振る):

```markdown
### エージェントの指示ファイル

> 前提: 端末で `DIR="$(mktemp -d)" && echo "$DIR"` を実行して空のフォルダを作り、アプリの `フォルダを開く` で開く(フォルダの選択画面では Cmd+Shift+G でパスを入力できる)。設定の `使うエージェント CLI` は `Claude Code` から始める。

- [ ] **EXP-074** 空のフォルダを開いてエクスプローラーを見る → ファイルツリーの上に `エージェントの指示ファイル(Claude Code)` の節があり、`CLAUDE.md`・`.claude/CLAUDE.md`・`CLAUDE.local.md` の 3 行に説明と `作成` が並ぶ
- [ ] **EXP-075** `CLAUDE.md` の行の `作成` を押す → `CLAUDE.md` がタブで開き、`# プロジェクトの指示` と `## 概要`・`## よく使うコマンド`・`## コーディングのルール` の見出しだけが書かれている。ツリーに `CLAUDE.md` が出て、節の行のボタンが `開く` に変わる
- [ ] **EXP-076** `.claude/CLAUDE.md` の行の `作成` を押す → ツリーに `.claude` フォルダとその中の `CLAUDE.md` が出て、タブで開く
- [ ] **EXP-077** `CLAUDE.local.md` の行の `作成` を押す → 1 行目が `# 個人の指示` のファイルが開く
- [ ] **EXP-078** 別のファイルを開いてから、節の `CLAUDE.md` の `開く` を押す → `CLAUDE.md` のタブに切り替わる(未保存の変更があるときは、ツリーで選んだときと同じ確認が出る)
- [ ] **EXP-079** 設定の `使うエージェント CLI` を `GitHub Copilot CLI` に変えてエクスプローラーに戻る → 見出しが `エージェントの指示ファイル(GitHub Copilot CLI)` になり、`AGENTS.md`・`.github/copilot-instructions.md` の 2 行が出る。`.github/copilot-instructions.md` の `作成` で `.github` フォルダの中に作られて開く
- [ ] **EXP-080** 端末で `echo mine > "$DIR/AGENTS.md"` を実行した後(ツリーにはまだ出ない)、`AGENTS.md` の `作成` を押す → 節に `同じ名前のファイルかフォルダが既にあります(大文字と小文字だけ違う名前を含みます)。ファイルツリーを確かめてください` が赤字で出る。端末で `cat "$DIR/AGENTS.md"` を実行すると `mine` のまま
- [ ] **EXP-081** 設定を `Claude Code` に戻し、端末で `rm "${DIR:?}/CLAUDE.local.md" && echo x > "${DIR:?}/claude.local.md"` を実行してから `フォルダを変更` で同じフォルダを開き直し、`CLAUDE.local.md` の `作成` を押す → macOS の既定(大文字と小文字を区別しない)では EXP-080 と同じ文言が出て、`claude.local.md` の中身は `x` のまま
- [ ] **EXP-082** 端末で `rm -r "${DIR:?}/.claude" && ln -s "$(mktemp -d)" "${DIR:?}/.claude"` を実行し、フォルダを開き直してから `.claude/CLAUDE.md` の `作成` を押す → 節に `フォルダの外には作成できません` が出る。端末で `ls -A "${DIR:?}/.claude/"` を実行すると何も表示されない(リンク先に何も作られていない)
- [ ] **EXP-083** サイドバーを最も狭い幅(220px)までドラッグで狭める → 節の説明が次の行へ折り返し、`開く`・`作成` のボタンは行の右端に収まる
- [ ] **EXP-084** `リポジトリを clone` で clone を実行している間に節を見る → `開く`・`作成` のボタンがすべて押せない
```

(EXP-081・EXP-082 の `rm` は `$DIR`(前提で作った一時フォルダ)の中だけを消す。`${DIR:?}` は `$DIR` が空なら何もせずに止まる。L-072)

`### エージェントの指示ファイル` の前提の最後に「`rm` を使う項目は、前提で作った `$DIR` の中だけを消す(`${DIR:?}` は、端末を開き直して `$DIR` が空のときは止まる)。」と 1 文足す。

- [ ] **Step 3: 文書を更新する**

- `docs/developer-guide.md` の 3.4 の「CLI の種類ごとの違いは表(…)にまとめてあり」の括弧の中に `src/shared/agentInstructionFiles.ts`(指示ファイルの一覧と雛形)を足す
- `README.md` に機能の一覧があれば、エクスプローラーの項に「エージェントの指示ファイル(`CLAUDE.md`・`AGENTS.md` など)を開く・雛形で作る」を 1 行足す

- [ ] **Step 4: 仕様書の HTML を再生成し、検査を通す**

Run: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
Expected: PASS(ID の一意性・連番・書式)

その後、Artifact(<manual-test-spec-artifact-url>)を同じファイルパス `.superpowers/manual-test-spec.html` で再公開する(これは実装のサブエージェントではなく、親のセッションが Artifact のツールで行う)。

- [ ] **Step 5: 全体を検証する**

Run(順に。`NODE_ENV` は test にする):
- `NODE_ENV=test npm test`
- `npm run typecheck`
- `npx eslint . --max-warnings 0`
- `npm run build`

Expected: すべて成功。時間切れで落ちたテストは単独で流し直して再現するか確かめる(開発者ガイド 6)
