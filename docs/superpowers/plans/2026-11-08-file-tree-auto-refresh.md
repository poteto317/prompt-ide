# ファイルツリー・ソース管理の自動更新（file watcher） 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェントやターミナルが作った・消した・書き換えたファイルと外で行った git の操作を、利用者が `更新` を押さなくても、ファイルツリー（と指示ファイルの節）・ソース管理の git status・アクティブな diff タブへ静かに反映する。

**Architecture:** main が、開いているフォルダのルートを `fs.watch` の recursive で所有者ごとに 1 本監視し、通知の相対パスを純粋な関数で「ツリー」「git だけ」「無視」に分けて、待ち 300ms・上限 1000ms でまとめて `fs:folderChange` を送る。監視を張るかは renderer の `fs:setFolderWatch`、どのフォルダかは main の許可フォルダで決め、`folder-changed` のたびに張り直す。renderer は新しい hook が通知とウィンドウのフォーカスの復帰を短い待ちで合流し、ツリー・git status・diff タブを「読み込み中の表示を出さず、内容が同じなら置き換えない」形で取り直す。git status の取得は `GIT_OPTIONAL_LOCKS=0` にして、アプリ自身の `git status` が `.git/index` を書いて次の通知を起こさないようにする。

**Tech Stack:** Electron 39（Node 22）+ React + TypeScript、simple-git 3.36.0、Vitest + Testing Library

**設計書:** `docs/superpowers/specs/2026-11-08-file-tree-auto-refresh-design.md`（各タスクの前に、そのタスクが挙げる節を読む。この設計書に全部従う）

## Global Constraints

- **コミットしない。** このプランの手順にコミット・プッシュは無い。各タスクの最後は「検証」で終える。コミットは後で別の手順で行う（プロジェクトの CLAUDE.md の規則）
- `git add -A` を使わない（使う場面が来ても `git add -u` か、パスを指定する）
- 型だけの import は `import type`。関数には戻り値の型を書く（テストを含む）
- renderer のファイルに `'use client'` を書かない（Electron の renderer で、既存のファイルにも無い。既存に合わせる）
- コメント・テストの名前・画面の文言は日本語。テストの名前（`it` の文字列）は「条件 → 期待する結果」の形
- テストは `NODE_ENV=test` を付けて走らせる（シェルの `NODE_ENV=production` で大量に落ちるため）。例: `NODE_ENV=test npx vitest run <パス>`
- テストの中の再帰的な削除は、必ず `src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPath`・`removeTempPathSync` を通す（`rm(…, { recursive: true })` を直接書かない。L-618）。一時フォルダは `mkdtemp(join(tmpdir(), …))` を `realpath` したもの
- `act(...).then(...)` の形で書かない。hook の非同期は `await act(async () => { ... })` で待つ
- テストで `setTimeout`・`setInterval` を自分で張るときは ID を控えて `afterEach` で消す（main の実物のテストは `src/main/__tests__/helpers/processProbe.ts` の `createTestTimers`。renderer は `vi.useFakeTimers()` と `afterEach` の `vi.useRealTimers()`）
- 配列の中で複数の Promise を始めてからループで 1 つずつ待たない。並べるときは `Promise.allSettled` に直接渡す（L-701）
- 新しい hook の引数・登録関数の引数・オプションの項目は省略できないものにする（L-060）
- 定数（設計書 3 章のとおり）: main の間引きは `FOLDER_CHANGE_WAIT_MS = 300`・`FOLDER_CHANGE_MAX_WAIT_MS = 1_000`。renderer の合流は `FOLDER_AUTO_REFRESH_WAIT_MS = 50`・`FOLDER_AUTO_REFRESH_MAX_WAIT_MS = 300`
- IPC: renderer → main は `fs:setFolderWatch`（引数 `enabled: boolean`。boolean でなければ例外）。main → renderer は `fs:folderChange`（payload `{ treeChanged: boolean }`。フォルダのパスは入れない）
- 監視は `fs.watch(folder, { recursive: true, persistent: false }, listener)`。Linux（`process.platform === 'linux'`）では張らない
- git status の `git.status()` だけを `GIT_OPTIONAL_LOCKS: '0'` を足した環境で実行する（`checkIsRepo`・`MERGE_HEAD` の確かめ・`git remote` は今のまま）
- 自動の取り直しは読み上げない（`aria-live` を足さない。L-249）。CSS は変えない（L-693）
- 静かな取り直しの失敗は画面に出さず、前の内容を残す（L-001・L-002）
- 各タスクの終わりに、そのタスクで変えたファイルへ `npx eslint <パス...> --max-warnings 0` と `npm run typecheck` を通す。整形の崩れは `npx prettier --write <パス>` で直す（変えたファイルだけに。L-199）
- 「実装を戻すとテストが落ちること」を各タスクで確かめる。新しいファイルは `git stash` で戻せないので、手順に書いた一時的な書き換えで確かめ、確かめたら必ず元に戻す
- 気をつける知見の ID（`$DEV_FLOW_KIT/lessons/review-lessons.md`。設計書 6 章 + 追加）: L-001, L-002, L-008, L-009, L-016, L-037, L-040, L-108, L-174, L-180, L-199, L-203, L-249, L-399, L-466, L-469, L-571, L-618, L-693, L-701

## ファイルの構成

| ファイル | 役割 |
| --- | --- |
| `src/main/folderChangeClassifier.ts`（新規） | 通知の相対パスを `tree`・`git`・`ignore` に分ける（純粋） |
| `src/main/folderChangeWatcher.ts`（新規） | 所有者ごとの recursive の監視と、待ち・上限の間引き |
| `src/main/folderChangeWatcherLifecycle.ts`（新規） | `folder-changed` で張り直し、破棄・クラッシュ・リロードで無効にする |
| `src/main/handlers/folderChangeHandlers.ts`（新規） | `fs:setFolderWatch` の受け口と `sendFolderChange` |
| `src/main/ipcHandlers.ts` | 監視の組み立て（Linux では張らない） |
| `src/main/gitInheritedEnv.ts`（新規） | simple-git の環境の検査を外す許可（`INHERITED_ENV_ALLOWANCES`）を共有する |
| `src/main/agentBaselineGit.ts` | 許可の定義を `gitInheritedEnv.ts` へ移す |
| `src/main/gitService.ts` | `getGitStatus` の `git.status()` を `GIT_OPTIONAL_LOCKS=0` で行う |
| `src/shared/types/fileSystem.ts` | `FolderChangeEvent` |
| `src/preload/api.ts`・`src/preload/index.d.ts` | `setFolderWatch`・`onFolderChange` |
| `src/renderer/src/lib/fileSystemApi.ts` | 同名の薄い包み |
| `src/renderer/src/__tests__/setup.ts` | `window.api` の stub |
| `src/renderer/src/lib/refreshScheduler.ts`（新規） | 待ち・上限・実行中の「もう 1 回」・世代の合流（React に依らない） |
| `src/renderer/src/hooks/useAgentChangesAutoRefresh.ts` | 合流を `refreshScheduler` に置き換える（挙動は変えない） |
| `src/renderer/src/lib/fileTreeEquality.ts`（新規） | `isSameFileTree`（純粋） |
| `src/renderer/src/lib/gitStatusEquality.ts`（新規） | `isSameGitStatus`（純粋） |
| `src/renderer/src/hooks/useFileTreeOperations.ts` | `reloadTree({ quiet })`・手動を追い越さない仕組み・`refreshTreeQuietly` |
| `src/renderer/src/hooks/useFileSystem.ts` | `refreshTreeQuietly`・`isFolderScanPending` を返す |
| `src/renderer/src/hooks/useGitStatus.ts` | `refreshGitStatusQuietly`・`wasGitStatusSetQuietly`・走査中の扱い |
| `src/renderer/src/hooks/useAgentChangesWiring.ts` | 静かに変わった status での一覧の取り直しを静かにする |
| `src/renderer/src/hooks/useFolderAutoRefresh.ts`（新規） | 通知とフォーカスの復帰の購読・合流・取り直し |
| `src/renderer/src/hooks/useAppState.ts` | 組み立て |
| 文書 | `docs/manual-test-spec.md`・`ROADMAP.md`・`README.md`・`docs/developer-guide.md` |

---

### Task 1: 変化の分類（main・純粋）

設計書: 3 章「変化の分類」、1 章「実物で確かめたこと」の 1〜3・7、4 章の分類のテスト。知見: L-009（大文字小文字は区別する。`shouldSkipDir` と同じ比べ方）、L-466（`.git` の中は一覧のパスだけ、`SKIP_DIRS` の中は捨てる）。

**Files:**
- Create: `src/main/folderChangeClassifier.ts`
- Test: `src/main/__tests__/folderChangeClassifier.test.ts`

**Interfaces:**
- Consumes: `MAX_DEPTH`（= 5）・`shouldSkipDir(name: string): boolean`（`src/main/traversalPolicy.ts`。既存）
- Produces:
  - `export type FolderChangeKind = 'tree' | 'git' | 'ignore'`
  - `export function classifyFolderChange(relativePath: string | null, platform: NodeJS.Platform): FolderChangeKind`
  - `tree` は「ツリーと git status の両方」、`git` は「git status だけ」を表す（Task 2 が `treeChanged` に使う）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/folderChangeClassifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyFolderChange } from '../folderChangeClassifier'
import type { FolderChangeKind } from '../folderChangeClassifier'

describe('classifyFolderChange', () => {
  it.each<[string, string | null, FolderChangeKind]>([
    ['名前が無い(null)は何が変わったか分からないので tree', null, 'tree'],
    ['空文字は tree', '', 'tree'],
    ['区切りだけ(分けた結果が空)は tree', '/', 'tree'],
    ['根の直下のファイルは tree', 'a.txt', 'tree'],
    ['先頭の区切りは捨てる', '/a.txt', 'tree'],
    ['6 段(ツリーに出る最も深い段)は tree', 'a/b/c/d/e/f.txt', 'tree'],
    ['7 段(ツリーに出ない)は git', 'a/b/c/d/e/f/g.txt', 'git'],
    ['node_modules の中は ignore', 'node_modules/x', 'ignore'],
    ['途中の dist の中は ignore', 'a/dist/x', 'ignore'],
    ['最後の要素が dist(その名前の項目そのもの)は段数で決める', 'dist', 'tree'],
    ['途中の最後の要素が dist でも段数で決める', 'a/dist', 'tree'],
    ['入れ子の .git の中は ignore', 'sub/.git/index', 'ignore'],
    ['.git そのもの(git init・削除・.git ファイルの作り直し)は tree', '.git', 'tree'],
    ['.git/index は git', '.git/index', 'git'],
    ['.git/HEAD は git', '.git/HEAD', 'git'],
    ['.git/MERGE_HEAD は git(外でのマージの中止)', '.git/MERGE_HEAD', 'git'],
    ['.git/packed-refs は git', '.git/packed-refs', 'git'],
    ['.git/refs/heads/main は git', '.git/refs/heads/main', 'git'],
    ['.git/refs/prompt-ide の下(アプリ自身の ref)は ignore', '.git/refs/prompt-ide/agent-changes/x', 'ignore'],
    ['.git/index.lock は ignore', '.git/index.lock', 'ignore'],
    ['.git/refs/heads/br.lock は ignore', '.git/refs/heads/br.lock', 'ignore'],
    ['.git/objects の下は ignore', '.git/objects/ab/cd', 'ignore'],
    ['.git/logs/HEAD は ignore', '.git/logs/HEAD', 'ignore'],
    ['.git/COMMIT_EDITMSG は ignore', '.git/COMMIT_EDITMSG', 'ignore'],
    ['.GIT/index は .git と区別する(ふつうの 2 段のファイル)', '.GIT/index', 'tree']
  ])('%s', (_label, relativePath, expected) => {
    expect(classifyFolderChange(relativePath, 'darwin')).toBe(expected)
  })

  it('win32 → \\ でも区切る(7 段を git に数える)', () => {
    expect(classifyFolderChange('a\\b\\c\\d\\e\\f\\g.txt', 'win32')).toBe('git')
    expect(classifyFolderChange('node_modules\\x', 'win32')).toBe('ignore')
    expect(classifyFolderChange('.git\\index', 'win32')).toBe('git')
  })

  it('darwin → \\ は区切りではない(1 段の名前に数える)', () => {
    expect(classifyFolderChange('a\\b\\c\\d\\e\\f\\g.txt', 'darwin')).toBe('tree')
    expect(classifyFolderChange('node_modules\\x', 'darwin')).toBe('tree')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeClassifier.test.ts`
Expected: FAIL（`../folderChangeClassifier` が無い）

- [ ] **Step 3: 実装する**

`src/main/folderChangeClassifier.ts`:

```ts
import { MAX_DEPTH, shouldSkipDir } from './traversalPolicy'

// 開いているフォルダの recursive の監視の通知(fs.watch の filename。根からの相対パス)を分ける(設計書 2026-11-08「変化の分類」)。
// tree: ツリーと git status の両方を取り直す。git: git status だけ(ツリーに出ない深さ・.git の中の確定した書き込み)。ignore: 何もしない。
// 名前の比べ方は大文字小文字を区別する(ツリーの shouldSkipDir と同じ。.git は git が小文字で作る。L-009)。
// イベントの種類(rename・change)は当てにならないので見ない

export type FolderChangeKind = 'tree' | 'git' | 'ignore'

const GIT_DIR = '.git'
/** .git の直下で、git status の結果に関わる名前(index・ブランチ・マージ中か・refs の書き方の 1 つ) */
const GIT_STATUS_FILES = new Set(['index', 'HEAD', 'MERGE_HEAD', 'packed-refs'])
/** アプリ自身が書く ref の置き場(refs/prompt-ide/…。エージェントの変更の記録を守る ref で、git status に出ない) */
const APP_REFS_DIR = 'prompt-ide'
const LOCK_SUFFIX = '.lock'

function splitRelativePath(relativePath: string, platform: NodeJS.Platform): string[] {
  const separator = platform === 'win32' ? /[\\/]/ : /\//
  return relativePath.split(separator).filter((segment) => segment !== '')
}

// .git の中(rest は .git を除いた要素。1 つ以上)。確定した書き込みは .lock の無い名前で届く
function classifyGitDirChange(rest: readonly string[]): FolderChangeKind {
  if (rest[rest.length - 1].endsWith(LOCK_SUFFIX)) return 'ignore'
  if (rest.length === 1 && GIT_STATUS_FILES.has(rest[0])) return 'git'
  if (rest[0] === 'refs') return rest[1] === APP_REFS_DIR ? 'ignore' : 'git'
  return 'ignore'
}

/** relativePath は fs.watch の filename(根からの相対パス)。null・空文字は分からないので 'tree' */
export function classifyFolderChange(
  relativePath: string | null,
  platform: NodeJS.Platform
): FolderChangeKind {
  if (relativePath === null || relativePath === '') return 'tree'
  const segments = splitRelativePath(relativePath, platform)
  if (segments.length === 0) return 'tree'
  if (segments[0] === GIT_DIR) {
    // .git そのもの: リポジトリかどうかが変わる(.git ファイルはツリーにも出る)
    if (segments.length === 1) return 'tree'
    return classifyGitDirChange(segments.slice(1))
  }
  // 途中に飛ばすディレクトリがあれば、ツリーに出ず git status も取り直さない(ビルドの出力・パッケージの導入の大量の通知)
  if (segments.slice(0, -1).some(shouldSkipDir)) return 'ignore'
  // ツリーに出るのは根からの相対パスで MAX_DEPTH + 1 段まで(readDirRecursive)。それより深い変化も git status は変えうる
  return segments.length <= MAX_DEPTH + 1 ? 'tree' : 'git'
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeClassifier.test.ts`
Expected: PASS

- [ ] **Step 5: 実装を戻すと落ちることを確かめる**

`classifyGitDirChange` の先頭の `.lock` の行を一時的に消して走らせ、`.git/refs/heads/br.lock は ignore` が落ちる（`git` になる）ことを確かめてから戻す。続けて `segments.slice(0, -1)` を一時的に `segments` にして走らせ、`最後の要素が dist …` の 2 件が落ちることを確かめてから戻す（L-180: 片側の分岐だけで通っていないか）

- [ ] **Step 6: 検証**

Run: `npx eslint src/main/folderChangeClassifier.ts src/main/__tests__/folderChangeClassifier.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 2: 監視（main）

設計書: 3 章「監視」、1 章「実物で確かめたこと」、4 章の監視・監視の実物のテスト。知見: L-037（閉じた監視の遅れた通知を今の監視の通知にしない）、L-108（`disable`・張り直しでタイマーを取り消す）、L-399（待ちと上限）、L-469（`enable` は同期）、L-571（A → B → A）、L-618（実物のテストの一時フォルダ）、L-174（「送らない」のテストは、監視が生きていることも確かめる）。

**Files:**
- Modify: `src/shared/types/fileSystem.ts`（`ExternalFileChangeEvent` の後に `FolderChangeEvent` を足す）
- Create: `src/main/folderChangeWatcher.ts`
- Test: `src/main/__tests__/folderChangeWatcher.test.ts`
- Test: `src/main/__tests__/folderChangeWatcher.integration.test.ts`

**Interfaces:**
- Consumes: `classifyFolderChange(relativePath: string | null, platform: NodeJS.Platform): FolderChangeKind`（Task 1）
- Produces:
  - `export interface FolderChangeEvent { treeChanged: boolean }`（`src/shared/types/fileSystem.ts`。`@shared/types` から import できる。`shared/types.ts` が `export type *` で再輸出している）
  - `export const FOLDER_CHANGE_WAIT_MS = 300`・`export const FOLDER_CHANGE_MAX_WAIT_MS = 1_000`
  - `export interface FolderWatch { close(): void; on(event: 'error', listener: (err: Error) => void): unknown }`
  - `export type WatchFolder = (folder: string, listener: (eventType: string, filename: string | Buffer | null) => void) => FolderWatch`
  - `export interface FolderChangeWatcherDeps { watch: WatchFolder | null; getFolder: (ownerId: number) => string | undefined; notify: (ownerId: number, event: FolderChangeEvent) => void; platform: NodeJS.Platform; waitMs?: number; maxWaitMs?: number }`
  - `export class FolderChangeWatcher { enable(ownerId: number): void; disable(ownerId: number): void; onFolderChanged(ownerId: number): void; watchedFolder(ownerId: number): string | null }`

- [ ] **Step 1: 型を足す**

`src/shared/types/fileSystem.ts` の末尾（`ExternalFileChangeEvent` の後）に足す:

```ts
/** fs:folderChange の通知。開いているフォルダの中で何かが変わった合図(パスは含めない。renderer は今のフォルダを読み直す)。
 *  treeChanged が偽なら、git status だけが変わりうる(ツリーに出ない深さ・.git の中の変化) */
export interface FolderChangeEvent {
  treeChanged: boolean
}
```

- [ ] **Step 2: 失敗する単体のテストを書く**

`src/main/__tests__/folderChangeWatcher.test.ts`（モックの `watch` と fake timer。`openFileWatcher.test.ts` と同じ型）:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  FOLDER_CHANGE_MAX_WAIT_MS,
  FOLDER_CHANGE_WAIT_MS,
  FolderChangeWatcher
} from '../folderChangeWatcher'
import type { FolderChangeWatcherDeps, FolderWatch, WatchFolder } from '../folderChangeWatcher'

afterEach(() => {
  vi.useRealTimers()
})

interface FakeWatch extends FolderWatch {
  folder: string
  closed: boolean
  fire(filename: string | Buffer | null): void
  fail(): void
}

function makeWatchFn(): { watch: ReturnType<typeof vi.fn<WatchFolder>>; watches: FakeWatch[] } {
  const watches: FakeWatch[] = []
  const watch = vi.fn<WatchFolder>((folder, listener) => {
    let onError: (err: Error) => void = () => undefined
    const fake: FakeWatch = {
      folder,
      closed: false,
      close: vi.fn(() => {
        fake.closed = true
      }),
      on: (_event, handler) => {
        onError = handler
        return fake
      },
      fire: (filename) => listener('rename', filename),
      fail: () => onError(new Error('EPERM'))
    }
    watches.push(fake)
    return fake
  })
  return { watch, watches }
}

function setup(overrides: Partial<FolderChangeWatcherDeps> = {}): {
  watcher: FolderChangeWatcher
  watch: ReturnType<typeof vi.fn<WatchFolder>>
  watches: FakeWatch[]
  notify: ReturnType<typeof vi.fn<FolderChangeWatcherDeps['notify']>>
  folders: Map<number, string>
} {
  const { watch, watches } = makeWatchFn()
  const notify = vi.fn<FolderChangeWatcherDeps['notify']>()
  const folders = new Map<number, string>()
  const watcher = new FolderChangeWatcher({
    watch,
    getFolder: (ownerId) => folders.get(ownerId),
    notify,
    platform: 'darwin',
    ...overrides
  })
  return { watcher, watch, watches, notify, folders }
}

describe('FolderChangeWatcher の張り方', () => {
  it('enable → 今の許可フォルダを張る', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    expect(watch).toHaveBeenCalledExactlyOnceWith('/repo', expect.any(Function))
    expect(watcher.watchedFolder(1)).toBe('/repo')
  })

  it('フォルダが無い間の enable → 張らず、onFolderChanged で張る', () => {
    const { watcher, watch, folders } = setup()
    watcher.enable(1)
    expect(watch).not.toHaveBeenCalled()
    folders.set(1, '/repo')
    watcher.onFolderChanged(1)
    expect(watch).toHaveBeenCalledExactlyOnceWith('/repo', expect.any(Function))
  })

  it('同じフォルダで enable を 2 回 → 張り直さない', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watcher.enable(1)
    expect(watch).toHaveBeenCalledOnce()
  })

  it('onFolderChanged → 前の監視を閉じて新しいフォルダを張る', () => {
    const { watcher, watches, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    expect(watches.map((w) => [w.folder, w.closed])).toEqual([
      ['/a', true],
      ['/b', false]
    ])
    expect(watcher.watchedFolder(1)).toBe('/b')
  })

  it('A → B → A → 3 回張られ、最後の監視が A(renderer の送り直しに頼らない。L-571)', () => {
    const { watcher, watch, watches, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    folders.set(1, '/a')
    watcher.onFolderChanged(1)
    expect(watch.mock.calls.map(([folder]) => folder)).toEqual(['/a', '/b', '/a'])
    expect(watches.map((w) => w.closed)).toEqual([true, true, false])
    expect(watcher.watchedFolder(1)).toBe('/a')
  })

  it('無効な所有者の onFolderChanged → 張らない', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/repo')
    watcher.onFolderChanged(1)
    expect(watch).not.toHaveBeenCalled()
    expect(watcher.watchedFolder(1)).toBeNull()
  })

  it('disable の後の onFolderChanged → 張らない', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    watcher.disable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    expect(watch).toHaveBeenCalledOnce()
  })

  it('watch が同期で投げる → enable は投げず、監視無しのまま', () => {
    const watch = vi.fn<WatchFolder>(() => {
      throw new Error('EMFILE')
    })
    const { watcher, folders } = setup({ watch })
    folders.set(1, '/repo')
    expect(() => watcher.enable(1)).not.toThrow()
    expect(watch).toHaveBeenCalledOnce()
    expect(watcher.watchedFolder(1)).toBeNull()
  })

  it('watch が null(Linux) → 何も張らない', () => {
    const { watcher, folders } = setup({ watch: null })
    folders.set(1, '/repo')
    expect(() => watcher.enable(1)).not.toThrow()
    expect(watcher.watchedFolder(1)).toBeNull()
  })

  it('error → 閉じて監視無しにし、同じフォルダのまま enable で張り直す', () => {
    const { watcher, watch, watches, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fail()
    expect(watches[0].closed).toBe(true)
    expect(watcher.watchedFolder(1)).toBeNull()
    watcher.enable(1)
    expect(watch).toHaveBeenCalledTimes(2)
    expect(watcher.watchedFolder(1)).toBe('/repo')
  })
})

describe('FolderChangeWatcher の通知', () => {
  it('最後の通知から 300ms 待って 1 回にまとめて送る', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(200)
    watches[0].fire('b.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS - 1)
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('通知が続いても、最初の通知から 1000ms で送る(上限。L-399)', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    for (let elapsed = 0; elapsed < FOLDER_CHANGE_MAX_WAIT_MS; elapsed += 200) {
      watches[0].fire('a.txt')
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('tree と git が混ざる → treeChanged: true', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('.git/index')
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('git だけ → treeChanged: false', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('.git/index')
    watches[0].fire(Buffer.from('.git/HEAD'))
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: false })
  })

  it('ignore だけ → 送らない。その後の tree は送る(監視が生きている)', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('node_modules/x/y.js')
    watches[0].fire('.git/index.lock')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('送った後は未送信を消す(次の git だけの通知は treeChanged: false)', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    watches[0].fire('.git/index')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify.mock.calls).toEqual([
      [1, { treeChanged: true }],
      [1, { treeChanged: false }]
    ])
  })

  it('disable → 監視を閉じ、予約を取り消す(送らない)', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('a.txt')
    watcher.disable(1)
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(watches[0].closed).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })

  it('張り直した後に閉じた監視の listener が呼ばれても送らない(L-037)', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
    watches[1].fire('b.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('張り直し → 前のフォルダの未送信を捨てる', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    watches[0].fire('a.txt')
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
  })

  it('error の後の通知 → 送らない', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fail()
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
  })

  it('notify が投げても、タイマーのコールバックは投げない', () => {
    vi.useFakeTimers()
    const notify = vi.fn<FolderChangeWatcherDeps['notify']>(() => {
      throw new Error('Object has been destroyed')
    })
    const { watcher, watches, folders } = setup({ notify })
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fire('a.txt')
    expect(() => vi.advanceTimersByTime(FOLDER_CHANGE_WAIT_MS)).not.toThrow()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('所有者ごとに別に送る', async () => {
    vi.useFakeTimers()
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/a')
    folders.set(2, '/b')
    watcher.enable(1)
    watcher.enable(2)
    watches[1].fire('.git/index')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(2, { treeChanged: false })
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeWatcher.test.ts`
Expected: FAIL（`../folderChangeWatcher` が無い）

- [ ] **Step 4: 実装する**

`src/main/folderChangeWatcher.ts`:

```ts
import type { FolderChangeEvent } from '@shared/types'
import { classifyFolderChange } from './folderChangeClassifier'

// 開いているフォルダの recursive の監視(設計書 2026-11-08「監視」)。所有者(webContents の id)ごとに、許可フォルダのルートを 1 本だけ
// 監視する。張るかは renderer の依頼(enable・disable)、どのフォルダかは main の許可フォルダ(getFolder)で決める(L-571)。
// 通知は classifyFolderChange で分け、待ち(最後の通知から)と上限(最初の未処理の通知から)の早い方で 1 回にまとめて送る(L-399)。
// 監視が張れない・error を受けたときは黙って監視無しにし、ウィンドウのフォーカスの復帰での取り直しに任せる。
// 開いているタブの監視(openFileWatcher.ts)とは別の監視(対象・名前の絞り方・rename への備えが違う)

export const FOLDER_CHANGE_WAIT_MS = 300
export const FOLDER_CHANGE_MAX_WAIT_MS = 1_000

export interface FolderWatch {
  close(): void
  on(event: 'error', listener: (err: Error) => void): unknown
}

/** フォルダを recursive で監視する */
export type WatchFolder = (
  folder: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FolderWatch

export interface FolderChangeWatcherDeps {
  /** null は「この環境では監視しない」(Linux) */
  watch: WatchFolder | null
  /** 所有者の今の許可フォルダ(FolderAccessManager.get) */
  getFolder: (ownerId: number) => string | undefined
  notify: (ownerId: number, event: FolderChangeEvent) => void
  platform: NodeJS.Platform
  waitMs?: number
  maxWaitMs?: number
}

interface OwnerState {
  /** 張っているフォルダ */
  folder: string | null
  watch: FolderWatch | null
  /** 未送信の分類に tree があるか */
  pendingTree: boolean
  hasPending: boolean
  waitTimer: ReturnType<typeof setTimeout> | null
  maxTimer: ReturnType<typeof setTimeout> | null
}

const createOwnerState = (): OwnerState => ({
  folder: null,
  watch: null,
  pendingTree: false,
  hasPending: false,
  waitTimer: null,
  maxTimer: null
})

export class FolderChangeWatcher {
  // 有効な所有者だけが入る(disable で消す)
  private readonly owners = new Map<number, OwnerState>()
  private readonly watchFolder: WatchFolder | null
  private readonly getFolder: FolderChangeWatcherDeps['getFolder']
  private readonly notify: FolderChangeWatcherDeps['notify']
  private readonly platform: NodeJS.Platform
  private readonly waitMs: number
  private readonly maxWaitMs: number

  constructor({
    watch,
    getFolder,
    notify,
    platform,
    waitMs = FOLDER_CHANGE_WAIT_MS,
    maxWaitMs = FOLDER_CHANGE_MAX_WAIT_MS
  }: FolderChangeWatcherDeps) {
    this.watchFolder = watch
    this.getFolder = getFolder
    this.notify = notify
    this.platform = platform
    this.waitMs = waitMs
    this.maxWaitMs = maxWaitMs
  }

  /** renderer の依頼。有効にして、今の許可フォルダを張る(張っていれば何もしない)。同期で行う(StrictMode の二重実行を到着の順に処理する。L-469) */
  enable(ownerId: number): void {
    let state = this.owners.get(ownerId)
    if (state === undefined) {
      state = createOwnerState()
      this.owners.set(ownerId, state)
    }
    const folder = this.getFolder(ownerId) ?? null
    if (state.watch !== null && state.folder === folder) return
    this.open(ownerId, state, folder)
  }

  /** renderer の依頼・リロード・クラッシュ・破棄。監視を閉じ、予約を取り消し、無効に戻す */
  disable(ownerId: number): void {
    const state = this.owners.get(ownerId)
    if (state === undefined) return
    this.closeCurrent(state)
    this.owners.delete(ownerId)
  }

  /** 許可フォルダが変わった。有効な所有者だけ、前の監視を閉じて新しいフォルダを張る */
  onFolderChanged(ownerId: number): void {
    const state = this.owners.get(ownerId)
    if (state === undefined) return
    this.open(ownerId, state, this.getFolder(ownerId) ?? null)
  }

  /** 監視しているフォルダ(テスト用) */
  watchedFolder(ownerId: number): string | null {
    const state = this.owners.get(ownerId)
    return state === undefined || state.watch === null ? null : state.folder
  }

  // 前の監視を閉じ、タイマーと未送信を捨ててから張る。張れなければ監視無しのまま(フォーカスの復帰に任せる)
  private open(ownerId: number, state: OwnerState, folder: string | null): void {
    this.closeCurrent(state)
    if (folder === null || this.watchFolder === null) return
    let created: FolderWatch | null = null
    try {
      created = this.watchFolder(folder, (_eventType, filename) => {
        // 閉じた監視の遅れた通知を、新しいフォルダの通知にしない(L-037)
        if (created === null || state.watch !== created) return
        this.onEvent(ownerId, state, filename)
      })
    } catch {
      // ENOENT・EMFILE など。監視無しのまま
      return
    }
    const watch = created
    watch.on('error', () => {
      if (state.watch !== watch) return
      // その場では張り直さない。次の folder-changed か enable で張り直す
      this.closeCurrent(state)
    })
    state.watch = watch
    state.folder = folder
  }

  private onEvent(ownerId: number, state: OwnerState, filename: string | Buffer | null): void {
    const kind = classifyFolderChange(filename === null ? null : filename.toString(), this.platform)
    if (kind === 'ignore') return
    state.pendingTree ||= kind === 'tree'
    state.hasPending = true
    if (state.waitTimer !== null) clearTimeout(state.waitTimer)
    state.waitTimer = setTimeout(() => this.flush(ownerId, state), this.waitMs)
    if (state.maxTimer === null) {
      state.maxTimer = setTimeout(() => this.flush(ownerId, state), this.maxWaitMs)
    }
  }

  // 待ちと上限のどちらで呼ばれても両方を取り消し、未送信を 1 回にまとめて送る
  private flush(ownerId: number, state: OwnerState): void {
    this.cancelTimers(state)
    if (!state.hasPending) return
    const event: FolderChangeEvent = { treeChanged: state.pendingTree }
    state.pendingTree = false
    state.hasPending = false
    // 送信先の破棄などで投げても、タイマーのコールバックから main の未捕捉例外にしない
    try {
      this.notify(ownerId, event)
    } catch {
      // 送れなかった変化は、フォーカスの復帰での取り直しに任せる
    }
  }

  private closeCurrent(state: OwnerState): void {
    const watch = state.watch
    state.watch = null
    state.folder = null
    this.cancelTimers(state)
    state.pendingTree = false
    state.hasPending = false
    if (watch === null) return
    try {
      watch.close()
    } catch {
      // 閉じられない監視は捨てる
    }
  }

  private cancelTimers(state: OwnerState): void {
    if (state.waitTimer !== null) clearTimeout(state.waitTimer)
    if (state.maxTimer !== null) clearTimeout(state.maxTimer)
    state.waitTimer = null
    state.maxTimer = null
  }
}
```

- [ ] **Step 5: 単体のテストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeWatcher.test.ts`
Expected: PASS

- [ ] **Step 6: 実物の監視の失敗するテストを書く**

`src/main/__tests__/folderChangeWatcher.integration.test.ts`（実物の `fs.watch`。途中のフォルダの作成の通知で判定が乱れないよう、入れ物のフォルダは監視を張る前に作り、張った後に落ち着くのを待ってから数える）:

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FolderChangeEvent } from '@shared/types'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderChangeWatcher } from '../folderChangeWatcher'
import { createTestTimers } from './helpers/processProbe'

// 実物の fs.watch の recursive で、分類どおりに送る・送らないことを確かめる(設計書 1 章「実物で確かめたこと」)。
// Linux は監視を張らない(設計書 2 章の 5)ので確かめない
describe.skipIf(process.platform === 'linux')('FolderChangeWatcher(実物の fs.watch の recursive)', () => {
  const timers = createTestTimers()
  let root: string
  let watcher: FolderChangeWatcher
  let notified: FolderChangeEvent[]

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'folder-change-watcher-')))
    mkdirSync(join(root, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
    mkdirSync(join(root, '.git'))
    notified = []
    watcher = new FolderChangeWatcher({
      watch: (folder, listener) => watch(folder, { recursive: true, persistent: false }, listener),
      getFolder: () => root,
      notify: (_ownerId, event) => notified.push(event),
      platform: process.platform,
      waitMs: 30,
      maxWaitMs: 100
    })
    watcher.enable(1)
    // 監視を張る前に作ったフォルダの通知が遅れて届くことがあるため、落ち着くのを待ってから数える
    await timers.delay(400)
    notified = []
  })

  afterEach(() => {
    watcher.disable(1)
    timers.clearAll()
    removeTempPathSync(root)
  })

  async function waitForNotification(): Promise<FolderChangeEvent | null> {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (notified.length > 0) return notified[0]
      await timers.delay(20)
    }
    return null
  }

  it('根の直下のファイルの作成 → treeChanged: true', async () => {
    writeFileSync(join(root, 'top.txt'), 'x')
    expect(await waitForNotification()).toEqual({ treeChanged: true })
  })

  it('7 段目のファイル → treeChanged: false', async () => {
    writeFileSync(join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'deep.txt'), 'x')
    expect(await waitForNotification()).toEqual({ treeChanged: false })
  })

  it('.git/index の書き込み → treeChanged: false', async () => {
    writeFileSync(join(root, '.git', 'index'), 'x')
    expect(await waitForNotification()).toEqual({ treeChanged: false })
  })

  it.each([
    ['node_modules/x/y.js', ['node_modules', 'x', 'y.js']],
    ['.git/index.lock', ['.git', 'index.lock']]
  ])('%s だけ → 送らない(続く根の直下の作成は送る)', async (_label, segments) => {
    writeFileSync(join(root, ...segments), 'x')
    await timers.delay(600)
    expect(notified).toEqual([])
    // 監視が生きていることを確かめる(送らないのが壊れた監視のせいでないこと。L-174)
    writeFileSync(join(root, 'after.txt'), 'x')
    expect(await waitForNotification()).toEqual({ treeChanged: true })
  })
})
```

- [ ] **Step 7: 実物のテストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeWatcher.integration.test.ts`
Expected: PASS（macOS）。落ちたら、届いた `filename` を一時的に `console.log` して設計書 1 章の 1〜3 と食い違っていないかを確かめ、食い違いは設計書の側の前提の誤りとして報告する（テストの期待を緩めて通さない）

- [ ] **Step 8: 実装を戻すと落ちることを確かめる**

`open` の listener の `if (created === null || state.watch !== created) return` を一時的に消して単体のテストを走らせ、`張り直した後に閉じた監視の listener が呼ばれても送らない` が落ちることを確かめてから戻す。続けて `onEvent` の上限のタイマーの 3 行を一時的に消して、`通知が続いても…上限` が落ちることを確かめてから戻す

- [ ] **Step 9: 検証**

Run: `npx eslint src/shared/types/fileSystem.ts src/main/folderChangeWatcher.ts src/main/__tests__/folderChangeWatcher.test.ts src/main/__tests__/folderChangeWatcher.integration.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 3: 寿命・IPC の受け口・組み立て（main）

設計書: 3 章「寿命」「IPC」の表・組み立て、2 章「監視を張るかを決めるのは renderer、どのフォルダを張るかを決めるのは main」。知見: L-571、L-469。

**Files:**
- Create: `src/main/folderChangeWatcherLifecycle.ts`
- Create: `src/main/handlers/folderChangeHandlers.ts`
- Modify: `src/main/ipcHandlers.ts`（`registerExternalChangeHandlers(...)` の行の後に足す）
- Test: `src/main/__tests__/folderChangeWatcherLifecycle.test.ts`（新規）
- Test: `src/main/__tests__/handlers/folderChangeHandlers.test.ts`（新規）
- Test: `src/main/__tests__/ipcHandlers.test.ts`（モックと 3 つのテストを足す）

**Interfaces:**
- Consumes: `FolderChangeWatcher`・`FOLDER_CHANGE_WAIT_MS`（Task 2）、`FolderChangeEvent`（Task 2）、`onOwnerContextEnded(app, folderAccess, listener)`（`ownerContextLifecycle.ts`。既存。`end.cause` は `'destroyed' | 'crashed' | 'reloaded' | 'folder-changed'`）、`sendToOwner(ownerId, channel, payload)`（`safeWebContentsSend.ts`。既存）
- Produces:
  - `export function setupFolderChangeWatcherLifecycle(app: App, watcher: FolderChangeWatcher, folderAccess: FolderAccessManager): void`
  - `export function sendFolderChange(ownerId: number, event: FolderChangeEvent): void`（`fs:folderChange` を送る）
  - `export function registerFolderChangeHandlers(ipcMain: IpcMain, watcher: Pick<FolderChangeWatcher, 'enable' | 'disable'>): void`（`fs:setFolderWatch`）

- [ ] **Step 1: 寿命の失敗するテストを書く**

`src/main/__tests__/folderChangeWatcherLifecycle.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { FolderChangeWatcher } from '../folderChangeWatcher'
import { setupFolderChangeWatcherLifecycle } from '../folderChangeWatcherLifecycle'

function setup(): {
  app: EventEmitter
  disable: ReturnType<typeof vi.spyOn>
  onFolderChanged: ReturnType<typeof vi.spyOn>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  const watcher = new FolderChangeWatcher({
    watch: null,
    getFolder: () => undefined,
    notify: vi.fn(),
    platform: 'darwin'
  })
  const disable = vi.spyOn(watcher, 'disable')
  const onFolderChanged = vi.spyOn(watcher, 'onFolderChanged')
  const folderAccess = new FolderAccessManager()
  setupFolderChangeWatcherLifecycle(app as unknown as App, watcher, folderAccess)
  return { app, disable, onFolderChanged, folderAccess }
}

describe('setupFolderChangeWatcherLifecycle', () => {
  it('フォルダの切り替え → onFolderChanged で張り直す(無効にしない)', () => {
    const { disable, onFolderChanged, folderAccess } = setup()
    folderAccess.set(3, '/a')
    expect(onFolderChanged).toHaveBeenCalledExactlyOnceWith(3)
    expect(disable).not.toHaveBeenCalled()
  })

  it.each<[string, (webContents: EventEmitter) => void]>([
    ['ウィンドウの破棄', (webContents) => webContents.emit('destroyed')],
    [
      'renderer のプロセスの終了',
      (webContents) => webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    ],
    [
      'リロード(did-navigate)',
      (webContents) => webContents.emit('did-navigate', {}, 'app://index.html', 200, 'OK')
    ]
  ])('%s → disable で無効にする(張り直さない)', (_label, end) => {
    const { app, disable, onFolderChanged } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    end(webContents)
    expect(disable).toHaveBeenCalledExactlyOnceWith(3)
    expect(onFolderChanged).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 受け口の失敗するテストを書く**

`src/main/__tests__/handlers/folderChangeHandlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFromId = vi.hoisted(() => vi.fn())
// 通知の送り先(所有者の webContents)を探す Electron の API だけを差し替える
vi.mock('electron', () => ({ webContents: { fromId: mockFromId } }))

import { registerFolderChangeHandlers, sendFolderChange } from '../../handlers/folderChangeHandlers'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const watcher = { enable: vi.fn(), disable: vi.fn() }

const setFolderWatch = (enabled: unknown): unknown =>
  handles.get('fs:setFolderWatch')?.({ sender: { id: 7 } }, enabled)

beforeEach(() => {
  handles.clear()
  vi.clearAllMocks()
  registerFolderChangeHandlers(ipcMain as never, watcher)
})

describe('fs:setFolderWatch', () => {
  it('true → 送信元の id で enable を同期で呼ぶ', () => {
    expect(setFolderWatch(true)).toBeUndefined()
    expect(watcher.enable).toHaveBeenCalledExactlyOnceWith(7)
    expect(watcher.disable).not.toHaveBeenCalled()
  })

  it('false → 送信元の id で disable を呼ぶ', () => {
    setFolderWatch(false)
    expect(watcher.disable).toHaveBeenCalledExactlyOnceWith(7)
    expect(watcher.enable).not.toHaveBeenCalled()
  })

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['文字列', 'true'],
    ['数', 1],
    ['null', null]
  ])('%s → 例外にし、どちらも呼ばない', (_label, value) => {
    expect(() => setFolderWatch(value)).toThrow('enabled は真偽値である必要があります')
    expect(watcher.enable).not.toHaveBeenCalled()
    expect(watcher.disable).not.toHaveBeenCalled()
  })
})

describe('sendFolderChange', () => {
  it('所有者の webContents へ fs:folderChange を送る', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send })
    sendFolderChange(3, { treeChanged: false })
    expect(mockFromId).toHaveBeenCalledWith(3)
    expect(send).toHaveBeenCalledWith('fs:folderChange', { treeChanged: false })
  })

  it('破棄済み・見つからない・送信で投げる → 呼び出し元へ投げない', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => true, send })
    sendFolderChange(3, { treeChanged: true })
    mockFromId.mockReturnValueOnce(undefined)
    expect(() => sendFolderChange(4, { treeChanged: true })).not.toThrow()
    mockFromId.mockReturnValueOnce({
      isDestroyed: () => false,
      send: () => {
        throw new Error('Object has been destroyed')
      }
    })
    expect(() => sendFolderChange(5, { treeChanged: true })).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 組み立ての失敗するテストを書く**

`src/main/__tests__/ipcHandlers.test.ts`:

1. `const mockSendExternalChange = vi.hoisted(() => vi.fn())` の行の後に足す:

```ts
const mockSetupFolderChangeWatcherLifecycle = vi.hoisted(() => vi.fn())
const mockRegisterFolderChangeHandlers = vi.hoisted(() => vi.fn())
const mockSendFolderChange = vi.hoisted(() => vi.fn())
```

2. `vi.mock('../handlers/externalChangeHandlers', …)` の後に足す:

```ts
vi.mock('../folderChangeWatcherLifecycle', () => ({
  setupFolderChangeWatcherLifecycle: mockSetupFolderChangeWatcherLifecycle
}))
vi.mock('../handlers/folderChangeHandlers', () => ({
  registerFolderChangeHandlers: mockRegisterFolderChangeHandlers,
  sendFolderChange: mockSendFolderChange
}))
```

3. `import { OpenFileWatcher, EXTERNAL_CHANGE_DEBOUNCE_MS } from '../openFileWatcher'` の後に足す:

```ts
import { FolderChangeWatcher, FOLDER_CHANGE_WAIT_MS } from '../folderChangeWatcher'
```

4. `describe('registerIpcHandlers', …)` の最後（`OpenFileWatcher は親ディレクトリを…` の後）に足す:

```ts
  it('開いているフォルダの監視の寿命と IPC に、同じ FolderAccessManager と同じ FolderChangeWatcher を渡す', () => {
    registerIpcHandlers(mockIpcMain)
    const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1]
    const [lifecycleApp, watcher, lifecycleFolderAccess] =
      mockSetupFolderChangeWatcherLifecycle.mock.calls[0]
    expect(lifecycleApp).toBe(mockApp)
    expect(watcher).toBeInstanceOf(FolderChangeWatcher)
    expect(lifecycleFolderAccess).toBe(folderAccess)
    expect(mockRegisterFolderChangeHandlers).toHaveBeenCalledExactlyOnceWith(mockIpcMain, watcher)
  })

  it('FolderChangeWatcher は許可フォルダを recursive・persistent: false で監視し、変化を sendFolderChange で所有者へ送る', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      vi.useFakeTimers()
      registerIpcHandlers(mockIpcMain)
      const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1] as FolderAccessManager
      const watcher = mockSetupFolderChangeWatcherLifecycle.mock.calls[0][1] as FolderChangeWatcher
      folderAccess.set(1, '/repo')
      mockWatch.mockClear()
      watcher.enable(1)
      expect(mockWatch).toHaveBeenCalledExactlyOnceWith(
        '/repo',
        { recursive: true, persistent: false },
        expect.any(Function)
      )
      const listener = (mockWatch.mock.calls[0] as unknown[])[2] as (
        eventType: string,
        filename: string | null
      ) => void
      listener('rename', 'a.txt')
      await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
      expect(mockSendFolderChange).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
      watcher.disable(1)
    } finally {
      platform.mockRestore()
    }
  })

  it('Linux では開いているフォルダの監視を張らない(設計書 2 章の 5)', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    try {
      registerIpcHandlers(mockIpcMain)
      const folderAccess = mockRegisterFileSystemHandlers.mock.calls[0][1] as FolderAccessManager
      const watcher = mockSetupFolderChangeWatcherLifecycle.mock.calls[0][1] as FolderChangeWatcher
      folderAccess.set(1, '/repo')
      mockWatch.mockClear()
      watcher.enable(1)
      expect(mockWatch).not.toHaveBeenCalled()
      expect(watcher.watchedFolder(1)).toBeNull()
    } finally {
      platform.mockRestore()
    }
  })
```

（`FolderAccessManager` は既に import されている。`mockApp` は `vi.mock('electron')` の `app`）

- [ ] **Step 4: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeWatcherLifecycle.test.ts src/main/__tests__/handlers/folderChangeHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: FAIL（新しいモジュールが無い。`ipcHandlers.test.ts` は新しい 3 件が落ちる）

- [ ] **Step 5: 寿命を実装する**

`src/main/folderChangeWatcherLifecycle.ts`:

```ts
import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'
import type { FolderChangeWatcher } from './folderChangeWatcher'
import { onOwnerContextEnded } from './ownerContextLifecycle'

// 開いているフォルダの監視の寿命(設計書 2026-11-08「寿命」)。フォルダの切り替えでは、有効な所有者だけ新しいフォルダを張り直す
// (renderer の送り直しに頼らない。L-571)。破棄・クラッシュ・リロードでは無効に戻す(リロードの後は、新しい文書の renderer が
// マウント時に有効にし直す。reloaded は新しい文書の preload より先に届く)。アプリの終了では閉じない(persistent: false)
export function setupFolderChangeWatcherLifecycle(
  app: App,
  watcher: FolderChangeWatcher,
  folderAccess: FolderAccessManager
): void {
  onOwnerContextEnded(app, folderAccess, (end) => {
    if (end.cause === 'folder-changed') watcher.onFolderChanged(end.ownerId)
    else watcher.disable(end.ownerId)
  })
}
```

- [ ] **Step 6: 受け口を実装する**

`src/main/handlers/folderChangeHandlers.ts`:

```ts
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { FolderChangeEvent } from '@shared/types'
import type { FolderChangeWatcher } from '../folderChangeWatcher'
import { sendToOwner } from '../safeWebContentsSend'

// 開いているフォルダの監視の IPC(設計書 2026-11-08「IPC」)。renderer は張るかだけを送り(パスは送らない)、どのフォルダかは
// main の許可フォルダで決める。通知の payload にもパスは入れない(今の所有者のフォルダで何かが変わった合図)

/** 開いているフォルダの変化の合図を、その所有者(webContents)へ送る。破棄済み・見つからなければ送らない */
export function sendFolderChange(ownerId: number, event: FolderChangeEvent): void {
  sendToOwner(ownerId, 'fs:folderChange', { treeChanged: event.treeChanged })
}

export function registerFolderChangeHandlers(
  ipcMain: IpcMain,
  watcher: Pick<FolderChangeWatcher, 'enable' | 'disable'>
): void {
  // 同期の関数を渡す(await を挟まず、StrictMode の true → false → true を到着の順に処理する。L-469)
  ipcMain.handle('fs:setFolderWatch', (event: IpcMainInvokeEvent, enabled: unknown): void => {
    if (typeof enabled !== 'boolean') throw new Error('enabled は真偽値である必要があります')
    if (enabled) watcher.enable(event.sender.id)
    else watcher.disable(event.sender.id)
  })
}
```

- [ ] **Step 7: 組み立てる**

`src/main/ipcHandlers.ts`:

import の `registerExternalChangeHandlers` のブロックの後に足す:

```ts
import { FolderChangeWatcher } from './folderChangeWatcher'
import { setupFolderChangeWatcherLifecycle } from './folderChangeWatcherLifecycle'
import {
  registerFolderChangeHandlers,
  sendFolderChange
} from './handlers/folderChangeHandlers'
```

`registerExternalChangeHandlers(ipcMain, folderAccess, openFileWatcher, globalInstructions)` の行の後に足す:

```ts
  // 開いているフォルダの recursive の監視(ツリー・ソース管理・diff タブの自動の取り直しの合図。設計書 2026-11-08)。
  // 張るかは renderer の fs:setFolderWatch、どのフォルダかは許可フォルダで決め、フォルダの切り替えで張り直す
  const folderChangeWatcher = new FolderChangeWatcher({
    // Linux は監視しない(全部の子孫に個別の監視を張り、除外を指定できないため。設計書 2 章)
    watch:
      process.platform === 'linux'
        ? null
        : (folder, listener) => watch(folder, { recursive: true, persistent: false }, listener),
    getFolder: (ownerId) => folderAccess.get(ownerId),
    notify: sendFolderChange,
    platform: process.platform
  })
  setupFolderChangeWatcherLifecycle(app, folderChangeWatcher, folderAccess)
  registerFolderChangeHandlers(ipcMain, folderChangeWatcher)
```

- [ ] **Step 8: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/folderChangeWatcherLifecycle.test.ts src/main/__tests__/handlers/folderChangeHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: PASS

- [ ] **Step 9: 実装を戻すと落ちることを確かめる**

`folderChangeWatcherLifecycle.ts` の分岐を一時的に `watcher.disable(end.ownerId)` だけにして走らせ、`フォルダの切り替え → onFolderChanged で張り直す` が落ちることを確かめてから戻す。`ipcHandlers.ts` の `process.platform === 'linux' ? null :` を一時的に外して、`Linux では…張らない` が落ちることを確かめてから戻す

- [ ] **Step 10: 検証**

Run: `npx eslint src/main/folderChangeWatcherLifecycle.ts src/main/handlers/folderChangeHandlers.ts src/main/ipcHandlers.ts src/main/__tests__/folderChangeWatcherLifecycle.test.ts src/main/__tests__/handlers/folderChangeHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 4: git status の取得を `GIT_OPTIONAL_LOCKS=0` で行う（main）

設計書: 3 章「git status の取得」、1 章の 8・9、5 章の `GIT_OPTIONAL_LOCKS=0` の制約。知見: L-466（自分の取り直しが次の通知を起こさない）、L-180（環境の検査を外す側と、環境を足す側の両方を固定する）。

**決めた解釈:** `src/main/__tests__/agentBaselineDependencies.test.ts` は「`agentBaselineGit` は同じ階層のどのモジュールも import しない」（`toEqual([])`）を検査している。許可の定義を `gitInheritedEnv.ts` へ移すと、この検査が落ちる。`gitInheritedEnv.ts` は同じ階層を import しない葉のモジュールなので、検査を「`agentBaselineGit` が import してよいのは `gitInheritedEnv` だけ」「`gitInheritedEnv` は同じ階層を import しない」に直す（記録の部品の依存の向き〈下位の詳細を上位が使う〉の意図は保つ）。

**Files:**
- Create: `src/main/gitInheritedEnv.ts`
- Modify: `src/main/agentBaselineGit.ts`（`INHERITED_ENV_ALLOWANCES` の定義と、その直前のコメントを移し、import に変える）
- Modify: `src/main/gitService.ts`（`getGitStatus` の `git.status()`）
- Test: `src/main/__tests__/agentBaselineDependencies.test.ts`（検査を直す）
- Test: `src/main/__tests__/gitService.test.ts`（`describe('getGitStatus')` に足す）
- Test: `src/main/__tests__/gitService.status.integration.test.ts`（末尾に `describe` を足す）

**Interfaces:**
- Consumes: なし（既存の simple-git の `unsafe`・`env()`）
- Produces:
  - `export const INHERITED_ENV_ALLOWANCES: Required<Omit<NonNullable<SimpleGitOptions['unsafe']>, 'allowUnsafeCustomBinary'>>`（`src/main/gitInheritedEnv.ts`）
  - `getGitStatus(folderPath: string): Promise<GitStatusResult>` の型は変えない（renderer は今の `git:getStatus` のまま）

- [ ] **Step 1: 失敗するテストを書く（単体）**

`src/main/__tests__/gitService.test.ts` の `describe('getGitStatus', () => {` の中の最初の `it` の前に足す:

```ts
  it('git status は GIT_OPTIONAL_LOCKS=0 を足した環境で、環境の検査を外した simple-git で取る(.git/index を書かない)', async () => {
    const before = process.env.GIT_OPTIONAL_LOCKS
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    await getGitStatus('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      unsafe: expect.objectContaining({ allowUnsafeAskPass: true, allowUnsafeEditor: true })
    })
    expect(mockEnv).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0', PATH: process.env.PATH })
    )
    expect(mockStatus).toHaveBeenCalledOnce()
    // process.env そのものは書き換えない
    expect(process.env.GIT_OPTIONAL_LOCKS).toBe(before)
  })
```

- [ ] **Step 2: 失敗するテストを書く（実物の git）**

`src/main/__tests__/gitService.status.integration.test.ts` の import に `statSync`・`readFileSync`・`utimesSync`（`fs`）を足し、末尾に足す:

```ts
// アプリの git status は .git/index を書かない(設計書 2026-11-08 の 1 章の 8・9。書くと監視の通知を起こし、取り直しが止まらなくなる)
describe('getGitStatus は .git/index を書かない(実 git)', () => {
  let root: string
  let repo: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'status-optional-locks-'))
    repo = join(root, 'repo')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', '1\n')
    commitAll(repo, 'first')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it('更新時刻が未来のファイルがあっても、getGitStatus の後に .git/index の mtime と中身が変わらない', async () => {
    // stat の情報が古いと、ふつうの git status は毎回 .git/index を書き直す(1 章の 8)
    const future = new Date('2099-01-01T00:00:00Z')
    utimesSync(join(repo, 'a.txt'), future, future)
    const indexPath = join(repo, '.git', 'index')
    const mtimeBefore = statSync(indexPath).mtimeMs
    const contentBefore = readFileSync(indexPath)
    await getGitStatus(repo)
    await getGitStatus(repo)
    expect(statSync(indexPath).mtimeMs).toBe(mtimeBefore)
    expect(readFileSync(indexPath).equals(contentBefore)).toBe(true)
  })

  it('GIT_ASKPASS が環境にあっても投げずに取れる(simple-git の環境の検査を外している)', async () => {
    vi.stubEnv('GIT_ASKPASS', '/usr/bin/true')
    await expect(getGitStatus(repo)).resolves.toMatchObject({ isRepo: true, branch: 'main' })
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.status.integration.test.ts`
Expected: FAIL（単体は `mockEnv` が呼ばれない。実物は mtime が変わる。`GIT_ASKPASS` のテストは今の実装〈`env()` を使わない〉では通る〈Step 7 で、`unsafe` を外すと落ちることを確かめる〉）

- [ ] **Step 4: 許可の定義を新しいモジュールへ移す**

`src/main/gitInheritedEnv.ts`（`agentBaselineGit.ts` の `INHERITED_ENV_ALLOWANCES` の定義と、その直前の 3 行のコメントの内容を移す。値は 1 字も変えない）:

```ts
import type { SimpleGitOptions } from 'simple-git'

// simple-git は env() で渡した環境を検査し、拒否する変数(GIT_ASKPASS・GIT_CONFIG_GLOBAL など)や GIT_CONFIG_KEY_n の設定があると
// 投げる。親の環境をそのまま引き継いで env() を使う git(方式の判定の git・git status の git)は、環境の検査だけを外す。
// 使う側は命令を固定し、-c も付けない。型で全部の分類を並べさせる(版を上げて分類が増えたら型が落ちる)
export const INHERITED_ENV_ALLOWANCES: Required<
  Omit<NonNullable<SimpleGitOptions['unsafe']>, 'allowUnsafeCustomBinary'>
> = {
  allowUnsafeAlias: true,
  allowUnsafeAskPass: true,
  allowUnsafeConfigPaths: true,
  allowUnsafeConfigEnvCount: true,
  allowUnsafeCredentialHelper: true,
  allowUnsafeEditor: true,
  allowUnsafeMergeDriver: true,
  allowUnsafePager: true,
  allowUnsafeProtocolOverride: true,
  allowUnsafePack: true,
  allowUnsafeSshCommand: true,
  allowUnsafeGitProxy: true,
  allowUnsafeHooksPath: true,
  allowUnsafeDiffExternal: true,
  allowUnsafeDiffTextConv: true,
  allowUnsafeFilter: true,
  allowUnsafeFsMonitor: true,
  allowUnsafeGpgProgram: true,
  allowUnsafeTemplateDir: true
}
```

`src/main/agentBaselineGit.ts`: `const INHERITED_ENV_ALLOWANCES … = { … }` の定義とその直前の 3 行のコメントを消し、`createModeGit` の JSDoc の前に 1 行のコメント `// 方式の判定の git は命令を rev-parse(checkIsRepo を含む)に固定する(環境の検査を外す理由は gitInheritedEnv.ts)` を置く。import の最後に `import { INHERITED_ENV_ALLOWANCES } from './gitInheritedEnv'` を足す。5 行目の `import type { SimpleGit, SimpleGitOptions } from 'simple-git'` は、`SimpleGitOptions` が移す定義の型にしか使われていないので `import type { SimpleGit } from 'simple-git'` にする（残すと使われない import で eslint が落ちる）。消した後に `grep -n "allowUnsafeAlias" src/main/agentBaselineGit.ts` が 0 件、`grep -n "SimpleGitOptions" src/main/agentBaselineGit.ts` が 0 件、`grep -n "INHERITED_ENV_ALLOWANCES" src/main/agentBaselineGit.ts` が import と `createModeGit` の 2 件であること（L-199）

`src/main/__tests__/agentBaselineDependencies.test.ts` の `git の起動の層(agentBaselineGit)は、…` のテストを次に置き換える:

```ts
  it('git の起動の層(agentBaselineGit)は、同じ階層では環境の検査の許可(gitInheritedEnv)だけを import する(記録の手順・方式の判定・registry を型でも参照しない)', () => {
    expect(localImportsOf('agentBaselineGit.ts')).toEqual(['gitInheritedEnv'])
  })

  it('環境の検査の許可(gitInheritedEnv)は、同じ階層のどのモジュールも import しない', () => {
    expect(localImportsOf('gitInheritedEnv.ts')).toEqual([])
  })
```

- [ ] **Step 5: git status の取得を変える**

`src/main/gitService.ts`:

import に足す（`import { simpleGitWithRemoteTimeout, … } from './gitRemoteTimeout'` の後）:

```ts
import { INHERITED_ENV_ALLOWANCES } from './gitInheritedEnv'
```

`getGitStatus` の前に足す:

```ts
/**
 * git status の git。git status は .git/index.lock を作って消し、作業ツリーの stat の情報が古いと .git/index も書き直す。
 * 開いているフォルダの監視は .git/index の変化で git status を取り直すため、アプリの git status が書くと次の通知を起こし、
 * 取り直しが止まらなくなりうる(設計書 2026-11-08 の 1 章の 8)。GIT_OPTIONAL_LOCKS=0 で書かせない(1 章の 9)。
 * GIT_OPTIONAL_LOCKS を渡すには env() が要るので、親の環境を引き継いだうえで環境の検査だけを外す。命令は status に固定する
 */
function createStatusGit(folderPath: string): Pick<SimpleGit, 'status'> {
  return simpleGit(folderPath, { unsafe: INHERITED_ENV_ALLOWANCES }).env({
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0'
  })
}
```

`getGitStatus` の `Promise.all` の中の `git.status(),` を `createStatusGit(folderPath).status(),` に変える（`hasMergeInProgress(git)`・`listRemoteNames(git)` は今のまま）

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.status.integration.test.ts src/main/__tests__/agentBaselineDependencies.test.ts src/main/__tests__/agentBaselineGit.test.ts`
Expected: PASS

- [ ] **Step 7: 実装を戻すと落ちることを確かめる**

`createStatusGit` の `.env({ … })` を一時的に外して（`simpleGit(folderPath, { unsafe: … })` だけを返す）実物のテストを走らせ、`mtime と中身が変わらない` が落ちることを確かめてから戻す。続けて `{ unsafe: INHERITED_ENV_ALLOWANCES }` を一時的に外して走らせ、`GIT_ASKPASS が環境にあっても…` が落ちる（`GitPluginError`）ことを確かめてから戻す

- [ ] **Step 8: 検証**

Run: `npx eslint src/main/gitInheritedEnv.ts src/main/agentBaselineGit.ts src/main/gitService.ts src/main/__tests__/agentBaselineDependencies.test.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.status.integration.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 5: preload と renderer の API の包み

設計書: 3 章「preload」。知見: L-037（形の合わない payload を捨てる）。

**Files:**
- Modify: `src/preload/api.ts`（`onExternalFileChange` の後に 2 つ足す。`import type { … } from '@shared/types'` に `FolderChangeEvent` を足す）
- Modify: `src/preload/index.d.ts`（`onExternalFileChange(…)` の宣言の後に 2 つ足す。型の import に `FolderChangeEvent` を足す）
- Modify: `src/renderer/src/lib/fileSystemApi.ts`（末尾に 2 つ足す）
- Modify: `src/renderer/src/__tests__/setup.ts`（`onExternalFileChange: () => () => {},` の後に 2 つ足す）
- Test: `src/preload/__tests__/api.test.ts`
- Test: `src/renderer/src/lib/__tests__/fileSystemApi.test.ts`

**Interfaces:**
- Consumes: `FolderChangeEvent`（Task 2）、チャンネル `fs:setFolderWatch`・`fs:folderChange`（Task 3）
- Produces:
  - `window.api.setFolderWatch(enabled: boolean): Promise<void>`・`window.api.onFolderChange(listener: (event: FolderChangeEvent) => void): () => void`
  - `fileSystemApi.setFolderWatch(enabled: boolean): Promise<void>`・`fileSystemApi.onFolderChange(listener: (event: FolderChangeEvent) => void): () => void`（Task 11 が使う）

- [ ] **Step 1: 失敗するテストを書く**

`src/preload/__tests__/api.test.ts`:

1. invoke の表（`'setWatchedFiles は fs:setWatchedFiles にパスを渡す'` の行の後）に足す:

```ts
    [
      'setFolderWatch は fs:setFolderWatch に真偽値を渡す',
      () => api.setFolderWatch(true),
      ['fs:setFolderWatch', true]
    ],
```

2. 購読の `describe.each`（`'onExternalFileChange'` の項目の後）に足す:

```ts
  [
    'onFolderChange',
    'fs:folderChange',
    (l: (p: unknown) => void) => api.onFolderChange(l),
    { treeChanged: true },
    [null, {}, { treeChanged: 'true' }, { treeChanged: 1 }]
  ],
```

3. ファイルの末尾に足す:

```ts
describe('onFolderChange の正規化', () => {
  it('treeChanged だけを渡す(ほかの項目は捨てる)', () => {
    const listener = vi.fn()
    api.onFolderChange(listener)
    const wrapped = mockOn.mock.calls.find(([ch]) => ch === 'fs:folderChange')?.[1]
    wrapped({}, { treeChanged: false, path: '/secret' })
    expect(listener).toHaveBeenCalledExactlyOnceWith({ treeChanged: false })
  })
})
```

`src/renderer/src/lib/__tests__/fileSystemApi.test.ts`: import に `setFolderWatch`・`onFolderChange` を、`mockApi` に `setFolderWatch: vi.fn()`・`onFolderChange: vi.fn()` を足し、最後の `describe` の中（`setWatchedFiles・onExternalFileChange は window.api に委譲する` の後）に足す:

```ts
  it('setFolderWatch・onFolderChange は window.api に委譲する', async () => {
    const unsubscribe = vi.fn()
    mockApi.onFolderChange.mockReturnValue(unsubscribe)
    await setFolderWatch(false)
    const listener = vi.fn()
    expect(onFolderChange(listener)).toBe(unsubscribe)
    expect(mockApi.setFolderWatch).toHaveBeenCalledWith(false)
    expect(mockApi.onFolderChange).toHaveBeenCalledWith(listener)
  })
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts`
Expected: FAIL（`api.setFolderWatch`・`setFolderWatch` が無い）

- [ ] **Step 3: preload を実装する**

`src/preload/api.ts` の `onExternalFileChange: … },` の後に足す:

```ts
  // 開いているフォルダの監視を張るかだけを送る(どのフォルダかは main の許可フォルダで決める。設計書 2026-11-08)
  setFolderWatch: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('fs:setFolderWatch', enabled),
  onFolderChange: (listener: (event: FolderChangeEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!isObjectLike(payload) || typeof payload.treeChanged !== 'boolean') return
      listener({ treeChanged: payload.treeChanged })
    }
    ipcRenderer.on('fs:folderChange', wrapped)
    return () => {
      ipcRenderer.removeListener('fs:folderChange', wrapped)
    }
  },
```

`src/preload/index.d.ts` の `onExternalFileChange(listener: (event: ExternalFileChangeEvent) => void): () => void` の後に足す:

```ts
      setFolderWatch(enabled: boolean): Promise<void>
      onFolderChange(listener: (event: FolderChangeEvent) => void): () => void
```

- [ ] **Step 4: renderer の包みと stub を足す**

`src/renderer/src/lib/fileSystemApi.ts`: 先頭の `import type { ExternalFileChangeEvent, WriteFileCheckedResult } from '@shared/types'` を `import type { ExternalFileChangeEvent, FolderChangeEvent, WriteFileCheckedResult } from '@shared/types'` にし、末尾に足す:

```ts
/** 開いているフォルダの監視を張る(true)・外す(false)。どのフォルダかは main が決める */
export function setFolderWatch(enabled: boolean): Promise<void> {
  return window.api.setFolderWatch(enabled)
}

/** 開いているフォルダの変化の合図を購読する。戻り値で解除する */
export function onFolderChange(listener: (event: FolderChangeEvent) => void): () => void {
  return window.api.onFolderChange(listener)
}
```

`src/renderer/src/__tests__/setup.ts` の `onExternalFileChange: () => () => {},` の後に足す:

```ts
    setFolderWatch: () => Promise.resolve(),
    onFolderChange: () => () => {},
```

- [ ] **Step 5: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts`
Expected: PASS

- [ ] **Step 6: 実装を戻すと落ちることを確かめる**

`onFolderChange` の `typeof payload.treeChanged !== 'boolean'` を一時的に消して走らせ、購読の `describe.each` の `onFolderChange` の「検証を通った payload で呼び…」が落ちることを確かめてから戻す

- [ ] **Step 7: 検証**

Run: `npx eslint src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/fileSystemApi.ts src/renderer/src/__tests__/setup.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 6: 合流のスケジューラ（renderer・React に依らない）と `useAgentChangesAutoRefresh` の置き換え

設計書: 3 章「合流」、1 章「今の合流の仕組み」。知見: L-108（`reset` でタイマーと実行中を下ろす）、L-399（上限）、L-203（14 行目のコメントを直す）。

**Files:**
- Create: `src/renderer/src/lib/refreshScheduler.ts`
- Test: `src/renderer/src/lib/__tests__/refreshScheduler.test.ts`
- Modify: `src/renderer/src/hooks/useAgentChangesAutoRefresh.ts`（合流の関数を消し、スケジューラを使う。コメントの 14 行目を直す）
- Test（変えない・通ることを確かめる）: `src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts`・`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`

**Interfaces:**
- Consumes: なし
- Produces（Task 11 も使う）:
  - `export interface RefreshSchedulerOptions<T> { waitMs: number; maxWaitMs: number; merge: (a: T, b: T) => T; run: (request: T) => Promise<void>; accepts: () => boolean }`
  - `export interface RefreshScheduler<T> { schedule: (request: T) => void; reset: () => void }`
  - `export function createRefreshScheduler<T>(options: RefreshSchedulerOptions<T>): RefreshScheduler<T>`
  - `useAgentChangesAutoRefresh` の引数・戻り値・`AUTO_REFRESH_WAIT_MS`・`AUTO_REFRESH_MAX_WAIT_MS` は変えない

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/refreshScheduler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRefreshScheduler } from '../refreshScheduler'
import type { RefreshScheduler, RefreshSchedulerOptions } from '../refreshScheduler'

interface Request {
  tree: boolean
}

const WAIT_MS = 50
const MAX_WAIT_MS = 300

function setup(overrides: Partial<RefreshSchedulerOptions<Request>> = {}): {
  scheduler: RefreshScheduler<Request>
  run: ReturnType<typeof vi.fn<RefreshSchedulerOptions<Request>['run']>>
  setAccepting: (value: boolean) => void
} {
  const run = vi.fn<RefreshSchedulerOptions<Request>['run']>(async () => undefined)
  let accepting = true
  const scheduler = createRefreshScheduler<Request>({
    waitMs: WAIT_MS,
    maxWaitMs: MAX_WAIT_MS,
    merge: (a, b) => ({ tree: a.tree || b.tree }),
    run,
    accepts: () => accepting,
    ...overrides
  })
  return {
    scheduler,
    run,
    setAccepting: (value) => {
      accepting = value
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve: () => void = () => undefined
  let reject: (err: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createRefreshScheduler', () => {
  it('最後の依頼から待ちの時間の後に 1 回だけ走らせる', async () => {
    const { scheduler, run } = setup()
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledExactlyOnceWith({ tree: false })
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).toHaveBeenCalledOnce()
  })

  it('依頼が続いても、最初の未処理の依頼から上限で走らせる(L-399)', async () => {
    const { scheduler, run } = setup()
    for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += 40) {
      scheduler.schedule({ tree: false })
      await vi.advanceTimersByTimeAsync(40)
    }
    expect(run).toHaveBeenCalledOnce()
  })

  it('未処理の依頼どうしを merge でまとめる', async () => {
    const { scheduler, run } = setup()
    scheduler.schedule({ tree: false })
    scheduler.schedule({ tree: true })
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledExactlyOnceWith({ tree: true })
  })

  it('実行中に届いた依頼は、終わった後の 1 回にまとめて走らせる', async () => {
    const { scheduler, run } = setup()
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledOnce()
    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run.mock.calls).toEqual([[{ tree: false }], [{ tree: true }]])
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('accepts が偽の間の依頼 → 予約しない(後で真になっても走らない)', async () => {
    const { scheduler, run, setAccepting } = setup()
    setAccepting(false)
    scheduler.schedule({ tree: true })
    setAccepting(true)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('予約の後に accepts が偽になる → 走らせる時に未処理を捨てる', async () => {
    const { scheduler, run, setAccepting } = setup()
    scheduler.schedule({ tree: true })
    setAccepting(false)
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    setAccepting(true)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('reset → 予約と未処理を捨てる', async () => {
    const { scheduler, run } = setup()
    scheduler.schedule({ tree: true })
    scheduler.reset()
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('reset の後 → 古い完了がやり直しを起こさず、新しい依頼は待たずに予約できる(L-108)', async () => {
    const { scheduler, run } = setup()
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.reset()
    first.resolve()
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).toHaveBeenCalledOnce()
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('run が reject → 止まらず、次の依頼を走らせる', async () => {
    const { scheduler, run } = setup()
    run.mockRejectedValueOnce(new Error('failed'))
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('run が同期で投げる → schedule のタイマーから投げず、次の依頼を走らせる', async () => {
    const { scheduler, run } = setup()
    run.mockImplementationOnce(() => {
      throw new Error('sync failure')
    })
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/refreshScheduler.test.ts`
Expected: FAIL（`../refreshScheduler` が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/refreshScheduler.ts`:

```ts
// 取り直しの合流(React に依らない。設計書 2026-11-08「合流」)。待ち(最後の依頼から)と上限(最初の未処理の依頼から)の早い方で
// 1 回にまとめて走らせる(L-399)。実行中に届いた依頼は「もう 1 回」の印を立てて、終わった後に 1 回だけ、たまった依頼で走らせる。
// reset は世代を進め、予約・未処理・実行中・印を下ろす(フォルダの切り替え・アンマウント。古い完了がやり直しを起こさない。L-108)

export interface RefreshSchedulerOptions<T> {
  waitMs: number
  maxWaitMs: number
  /** 未処理の依頼どうしを 1 つにまとめる */
  merge: (a: T, b: T) => T
  run: (request: T) => Promise<void>
  /** 受け付けるか。予約の時と走らせる時の両方で呼ぶ(false なら捨てる) */
  accepts: () => boolean
}

export interface RefreshScheduler<T> {
  /** 待ちを張り直し、上限は最初の未処理の依頼で張る */
  schedule: (request: T) => void
  /** 予約と未処理を捨て、実行中の完了を古いものにする(フォルダの切り替え・アンマウント) */
  reset: () => void
}

export function createRefreshScheduler<T>({
  waitMs,
  maxWaitMs,
  merge,
  run,
  accepts
}: RefreshSchedulerOptions<T>): RefreshScheduler<T> {
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  // 未処理の依頼(T が偽になりうる値でも「無い」と区別するため包む)
  let pending: { request: T } | null = null
  let running = false
  let rerun = false
  let generation = 0

  const cancelTimers = (): void => {
    if (waitTimer !== null) clearTimeout(waitTimer)
    if (maxTimer !== null) clearTimeout(maxTimer)
    waitTimer = null
    maxTimer = null
  }

  // 同期で投げても reject として扱う(タイマーのコールバックから投げない)
  const runSafely = (request: T): Promise<void> => {
    try {
      return run(request)
    } catch (err) {
      return Promise.reject(err)
    }
  }

  // 待ちと上限のどちらで呼ばれても両方を取り消す
  const fire = (): void => {
    cancelTimers()
    if (pending === null) return
    if (!accepts()) {
      pending = null
      return
    }
    if (running) {
      rerun = true
      return
    }
    const { request } = pending
    pending = null
    running = true
    const startedGeneration = generation
    void runSafely(request)
      .catch(() => undefined)
      .finally(() => {
        if (generation !== startedGeneration) return
        running = false
        if (!rerun) return
        rerun = false
        fire()
      })
  }

  return {
    schedule: (request) => {
      if (!accepts()) return
      pending = pending === null ? { request } : { request: merge(pending.request, request) }
      if (waitTimer !== null) clearTimeout(waitTimer)
      waitTimer = setTimeout(fire, waitMs)
      if (maxTimer === null) maxTimer = setTimeout(fire, maxWaitMs)
    },
    reset: () => {
      generation += 1
      cancelTimers()
      pending = null
      running = false
      rerun = false
    }
  }
}
```

- [ ] **Step 4: スケジューラのテストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/refreshScheduler.test.ts`
Expected: PASS

- [ ] **Step 5: `useAgentChangesAutoRefresh` をスケジューラに置き換える**

`src/renderer/src/hooks/useAgentChangesAutoRefresh.ts`:

1. 冒頭のコメントの 14 行目の `// 取り直すのはエージェントの変更の一覧だけで(git status は取り直さない。ソース管理の既存の手動テストの前提を変えない)、件数は読み上げない` を `// 取り直すのはエージェントの変更の一覧だけで(git status は取り直さない。git status の自動の取り直しは useFolderAutoRefresh が行う)、件数は読み上げない` に変える（一致しなければ失敗する置換で行う。L-199）
2. `interface AutoRefreshState`・`cancelTimers`・`runAutoRefresh`・`scheduleAutoRefresh`・`resetAutoRefresh` を消し、`interface AutoRefreshDeps` は残す。import を次にする（`advanceAgentNotifications`・`AgentChangesRefreshOptions`・`useLatestRef`・`useOnChange` の import は残す）:

```ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentNotificationTab } from '../lib/agentNotificationEvents'
import { advanceAgentNotifications } from '../lib/agentNotificationEvents'
import { createRefreshScheduler } from '../lib/refreshScheduler'
import type { RefreshScheduler } from '../lib/refreshScheduler'
import type { AgentChangesRefreshOptions } from './useAgentChanges'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'
```

3. `interface AutoRefreshDeps` の後に足す:

```ts
// 合流(待ち・上限・実行中のもう 1 回・世代)は lib/refreshScheduler。最初に使うときに作り、描画の中では ref を読まない
function ensureScheduler(
  schedulerRef: RefObject<RefreshScheduler<true> | null>,
  deps: RefObject<AutoRefreshDeps>
): RefreshScheduler<true> {
  schedulerRef.current ??= createRefreshScheduler<true>({
    waitMs: AUTO_REFRESH_WAIT_MS,
    maxWaitMs: AUTO_REFRESH_MAX_WAIT_MS,
    merge: () => true,
    run: () => deps.current.refresh(),
    accepts: () => deps.current.isRecording
  })
  return schedulerRef.current
}
```

4. hook の本体を次にする:

```ts
export function useAgentChangesAutoRefresh({
  isRecording,
  folderPath,
  refresh,
  tabs,
  activities
}: AgentChangesAutoRefreshOptions): void {
  const schedulerRef = useRef<RefreshScheduler<true> | null>(null)
  const depsRef = useLatestRef<AutoRefreshDeps>({
    isRecording,
    // 静かに取る(isLoading を立てない・一覧が同じなら写しを置き換えない。設計書「自動の取り直し」)
    refresh: () => refresh({ announce: false, quiet: true })
  })
  // タブごとの最後の確かな活動(通知の useAgentNotifications と同じ純粋な関数で出来事を決める。こちらは自分の控えを持つ)
  const settledRef = useRef<ReadonlyMap<string, AgentActivity>>(new Map())

  // 活動の出来事。活動の Map は内容が同じなら同じ参照のままなので、タブの一覧の変化でも見直す(useAgentNotifications と同じ)
  useEffect(() => {
    const { settled, events } = advanceAgentNotifications(settledRef.current, tabs, activities)
    settledRef.current = settled
    if (events.length > 0) ensureScheduler(schedulerRef, depsRef).schedule(true)
  }, [tabs, activities, depsRef])

  // ウィンドウのフォーカスの復帰(useExternalFileChanges と同じ購読の形)。アンマウントで予約も取り消す
  useEffect(() => {
    const scheduler = ensureScheduler(schedulerRef, depsRef)
    const onFocus = (): void => scheduler.schedule(true)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') scheduler.schedule(true)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      scheduler.reset()
    }
  }, [depsRef])

  // 記録中でなくなった・フォルダが変わったら、予約を取り消す(記録中に戻ったときに古い予約で走らない)
  useOnChange(isRecording, () => {
    if (!isRecording) schedulerRef.current?.reset()
  })
  useOnChange(folderPath, () => schedulerRef.current?.reset())
}
```

- [ ] **Step 6: 既存のテストがそのまま通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/refreshScheduler.test.ts src/renderer/src/hooks/__tests__/useAgentChangesAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`
Expected: PASS（`useAgentChangesAutoRefresh.test.ts` は 1 行も変えない。落ちたら挙動が変わっているので、スケジューラか hook を直す）

- [ ] **Step 7: 実装を戻すと落ちることを確かめる**

`refreshScheduler.ts` の `finally` の `if (generation !== startedGeneration) return` を一時的に消して走らせ、`reset の後 → 古い完了がやり直しを起こさず…` が落ちることを確かめてから戻す。続けて `schedule` の `if (maxTimer === null) maxTimer = …` を一時的に消して、スケジューラの上限のテストと `useAgentChangesAutoRefresh.test.ts` の上限のテストが落ちることを確かめてから戻す

- [ ] **Step 8: 検証**

Run: `npx eslint src/renderer/src/lib/refreshScheduler.ts src/renderer/src/lib/__tests__/refreshScheduler.test.ts src/renderer/src/hooks/useAgentChangesAutoRefresh.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 7: 同じかの比べ（renderer・純粋）

設計書: 3 章「ツリーの静かな読み直し」の `isSameFileTree`、「git status の静かな取り直し」の `isSameGitStatus`。知見: L-203（比べ忘れのフィールドを型で防ぐ）。

**Files:**
- Create: `src/renderer/src/lib/fileTreeEquality.ts`
- Create: `src/renderer/src/lib/gitStatusEquality.ts`
- Test: `src/renderer/src/lib/__tests__/fileTreeEquality.test.ts`
- Test: `src/renderer/src/lib/__tests__/gitStatusEquality.test.ts`

**Interfaces:**
- Consumes: `FileTreeNode`（`src/renderer/src/types.ts`。既存）、`GitStatusResult`・`GitFileStatus`（`@shared/types`。既存）
- Produces:
  - `export function isSameFileTree(a: readonly FileTreeNode[], b: readonly FileTreeNode[]): boolean`（Task 8）
  - `export function isSameGitStatus(a: GitStatusResult | null, b: GitStatusResult | null): boolean`（Task 9）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/fileTreeEquality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { FileTreeNode } from '../../types'
import { isSameFileTree } from '../fileTreeEquality'

const tree = (): FileTreeNode[] => [
  {
    name: 'src',
    path: '/p/src',
    type: 'directory',
    children: [{ name: 'a.ts', path: '/p/src/a.ts', type: 'file' }]
  },
  { name: 'b.txt', path: '/p/b.txt', type: 'file' }
]

describe('isSameFileTree', () => {
  it('中身が同じ別の配列 → true', () => {
    expect(isSameFileTree(tree(), tree())).toBe(true)
  })

  it('同じ参照 → true', () => {
    const t = tree()
    expect(isSameFileTree(t, t)).toBe(true)
  })

  it.each<[string, (t: FileTreeNode[]) => FileTreeNode[]]>([
    ['名前が違う', (t) => [{ ...t[0], name: 'lib' }, t[1]]],
    ['パスが違う', (t) => [t[0], { ...t[1], path: '/p/c.txt' }]],
    ['種類が違う', (t) => [t[0], { ...t[1], type: 'directory', children: [] }]],
    [
      '子が違う',
      (t) => [{ ...t[0], children: [{ name: 'x.ts', path: '/p/src/x.ts', type: 'file' }] }, t[1]]
    ],
    ['子が無い(undefined)と空の配列', (t) => [{ ...t[0], children: undefined }, t[1]]],
    ['順が違う', (t) => [t[1], t[0]]],
    ['長さが違う', (t) => [t[0]]]
  ])('%s → false', (_label, change) => {
    expect(isSameFileTree(tree(), change(tree()))).toBe(false)
  })
})
```

`src/renderer/src/lib/__tests__/gitStatusEquality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { isSameGitStatus } from '../gitStatusEquality'

const status = (): GitStatusResult => ({
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [
    { path: 'a.txt', index: ' ', workingDir: 'M' },
    { path: 'b.txt', index: 'R', workingDir: ' ', from: 'old.txt' }
  ],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
})

describe('isSameGitStatus', () => {
  it('中身が同じ別のオブジェクト → true', () => {
    expect(isSameGitStatus(status(), status())).toBe(true)
  })

  it('両方 null → true、片方だけ null → false', () => {
    expect(isSameGitStatus(null, null)).toBe(true)
    expect(isSameGitStatus(status(), null)).toBe(false)
    expect(isSameGitStatus(null, status())).toBe(false)
  })

  it.each<[string, Partial<GitStatusResult>]>([
    ['isRepo', { isRepo: false }],
    ['branch', { branch: 'dev' }],
    ['ahead', { ahead: 1 }],
    ['behind', { behind: 2 }],
    ['mergeInProgress', { mergeInProgress: true }],
    ['hasOrigin', { hasOrigin: false }],
    ['hasRemote', { hasRemote: false }],
    ['upstream', { upstream: null }],
    ['detached', { detached: true }]
  ])('%s が違う → false', (_label, change) => {
    expect(isSameGitStatus(status(), { ...status(), ...change })).toBe(false)
  })

  it.each<[string, (s: GitStatusResult) => GitStatusResult]>([
    ['ファイルの文字(workingDir)', (s) => ({ ...s, files: [{ ...s.files[0], workingDir: 'D' }, s.files[1]] })],
    ['ファイルの文字(index)', (s) => ({ ...s, files: [{ ...s.files[0], index: 'M' }, s.files[1]] })],
    ['ファイルのパス', (s) => ({ ...s, files: [{ ...s.files[0], path: 'c.txt' }, s.files[1]] })],
    ['from の有無', (s) => ({ ...s, files: [s.files[0], { path: 'b.txt', index: 'R', workingDir: ' ' }] })],
    ['ファイルの順', (s) => ({ ...s, files: [s.files[1], s.files[0]] })],
    ['ファイルの数', (s) => ({ ...s, files: [s.files[0]] })]
  ])('%s が違う → false', (_label, change) => {
    expect(isSameGitStatus(status(), change(status()))).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/fileTreeEquality.test.ts src/renderer/src/lib/__tests__/gitStatusEquality.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/fileTreeEquality.ts`:

```ts
import type { FileTreeNode } from '../types'

// 静かな読み直しで、内容が同じツリーを置き換えない(ツリーと指示ファイルの節を描き直さない)ための比べ(設計書 2026-11-08)。
// main が sortFileTree で並べるので、並びの順のまま比べる

export function isSameFileTree(a: readonly FileTreeNode[], b: readonly FileTreeNode[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((node, index) => isSameNode(node, b[index]))
}

function isSameNode(a: FileTreeNode, b: FileTreeNode): boolean {
  if (a.name !== b.name || a.path !== b.path || a.type !== b.type) return false
  if (a.children === undefined || b.children === undefined) return a.children === b.children
  return isSameFileTree(a.children, b.children)
}
```

`src/renderer/src/lib/gitStatusEquality.ts`:

```ts
import type { GitFileStatus, GitStatusResult } from '@shared/types'

// 静かな取り直しで、内容が同じ git status を置き換えない(エージェントの変更の一覧・diff の連鎖を起こさない)ための比べ
// (設計書 2026-11-08)。フィールドを足したら下の 2 つの表が型エラーになり、比べ忘れを防ぐ

const STATUS_FIELDS: Record<Exclude<keyof GitStatusResult, 'files'>, true> = {
  isRepo: true,
  branch: true,
  ahead: true,
  behind: true,
  mergeInProgress: true,
  hasOrigin: true,
  hasRemote: true,
  upstream: true,
  detached: true
}

const FILE_FIELDS: Record<keyof GitFileStatus, true> = {
  path: true,
  index: true,
  workingDir: true,
  from: true
}

const statusKeys = Object.keys(STATUS_FIELDS) as (keyof typeof STATUS_FIELDS)[]
const fileKeys = Object.keys(FILE_FIELDS) as (keyof GitFileStatus)[]

function isSameFiles(a: readonly GitFileStatus[], b: readonly GitFileStatus[]): boolean {
  if (a.length !== b.length) return false
  // from は無いとき(undefined)どうしで同じ。main は値があるときだけ from を入れる
  return a.every((file, index) => fileKeys.every((key) => file[key] === b[index][key]))
}

/** どちらかが null なら、両方 null のときだけ同じ */
export function isSameGitStatus(a: GitStatusResult | null, b: GitStatusResult | null): boolean {
  if (a === null || b === null) return a === b
  return statusKeys.every((key) => a[key] === b[key]) && isSameFiles(a.files, b.files)
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/fileTreeEquality.test.ts src/renderer/src/lib/__tests__/gitStatusEquality.test.ts`
Expected: PASS

- [ ] **Step 5: 実装を戻すと落ちることを確かめる**

`STATUS_FIELDS` から `detached: true` を一時的に消すと型エラー（`npm run typecheck`）になることを確かめてから戻す。`isSameNode` の `children` の行を一時的に `return true` にして、`子が違う` が落ちることを確かめてから戻す

- [ ] **Step 6: 検証**

Run: `npx eslint src/renderer/src/lib/fileTreeEquality.ts src/renderer/src/lib/gitStatusEquality.ts src/renderer/src/lib/__tests__/fileTreeEquality.test.ts src/renderer/src/lib/__tests__/gitStatusEquality.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 8: ツリーの静かな読み直し（`useFileTreeOperations`・`useFileSystem`）

設計書: 3 章「ツリーの静かな読み直し」（(a) を採る）、4 章のツリーのテスト。知見: L-001（反映したかを null で返す）、L-002（失敗を空にしない）、L-040（手動と静かで世代を共有し、比べる相手は完了の時点の最新）、L-180（成功・失敗・古い結果のどの終わり方でも「手動の後に 1 回」が走る）。

**決めた解釈:** 指示ファイルの作成のテスト（設計書 4 章は `useAgentInstructionFiles.test.ts` に足すと書く）は、実物の `useFileSystem` と `useAgentInstructionFiles` を一緒に描画し、`fileSystemApi`・`agentInstructionsApi` をモジュールごと差し替える必要がある。既存の `useAgentInstructionFiles.test.ts` にモジュールの差し替えを足すと、その全部のテストの前提が変わるため、同じ hook のテストの別ファイル `useAgentInstructionFiles.quietReload.test.ts` に置く（`useAgentInstructionFiles.global.test.ts` と同じ分け方）。

**Files:**
- Modify: `src/renderer/src/hooks/useFileTreeOperations.ts`（`reloadTree`・`refreshTree`・返り値・型）
- Modify: `src/renderer/src/hooks/useFileSystem.ts`（`useFileTreeOperations` の分割代入・`FileSystemState`・返り値）
- Test: `src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`（補助を直し、`describe` を足す）
- Test: `src/renderer/src/hooks/__tests__/useFileSystem.test.ts`（1 件足す）
- Test（新規）: `src/renderer/src/hooks/__tests__/useAgentInstructionFiles.quietReload.test.ts`

**Interfaces:**
- Consumes: `isSameFileTree`（Task 7）
- Produces:
  - `useFileTreeOperations` の返り値に `refreshTreeQuietly: () => Promise<void>`（投げない）
  - `useFileSystem` の返り値（`FileSystemState`）に `refreshTreeQuietly: () => Promise<void>` と `isFolderScanPending: () => boolean`（`pendingFolderOpenRef.current > 0`）。Task 9・Task 11 が使う
  - `refreshTree: () => Promise<boolean>` と `createAgentInstructionFile` の型・挙動は変えない

- [ ] **Step 1: テストの補助を直す**

`src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`:

- `interface RenderOperationsConfig` に `reportTreeLoad?: (error: Error | null) => void` を足す
- `interface RenderedOperations` に `reportTreeLoad: NonNullable<RenderOperationsConfig['reportTreeLoad']>` を足す
- `renderOperations` の先頭に `const reportTreeLoad = config?.reportTreeLoad ?? vi.fn()` を足し、`useFileTreeOperations({ … reportTreeLoad: vi.fn() })` の `reportTreeLoad: vi.fn()` を `reportTreeLoad` に変え、戻り値のオブジェクトに `reportTreeLoad` を足す（`renderOperationsWithFolder` は変えない）

- [ ] **Step 2: 失敗するテストを書く（useFileTreeOperations）**

同じファイルの末尾に足す:

```ts
describe('静かな読み直し(refreshTreeQuietly)', () => {
  const treeA: FileTreeNode[] = [{ name: 'a.ts', path: '/project/a.ts', type: 'file' }]
  const treeB: FileTreeNode[] = [
    { name: 'a.ts', path: '/project/a.ts', type: 'file' },
    { name: 'b.ts', path: '/project/b.ts', type: 'file' }
  ]

  function deferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (err: Error) => void
  } {
    let resolve: (value: T) => void = () => undefined
    let reject: (err: Error) => void = () => undefined
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  async function renderWithTree(
    config?: RenderOperationsConfig
  ): Promise<RenderedOperations> {
    const rendered = renderOperations(config)
    mockReadDirectory.mockResolvedValueOnce(structuredClone(treeA))
    await act(async () => {
      await rendered.result.current.refreshTree()
    })
    return rendered
  }

  it('同じ内容のツリー → 置き換えない(参照が同じ)。読み込みの失敗の表示は消す', async () => {
    const { result, reportTreeLoad } = await renderWithTree()
    const before = result.current.fileTree
    vi.mocked(reportTreeLoad).mockClear()
    mockReadDirectory.mockResolvedValueOnce(structuredClone(treeA))
    await act(async () => {
      await result.current.refreshTreeQuietly()
    })
    expect(result.current.fileTree).toBe(before)
    expect(reportTreeLoad).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('違う内容のツリー → 置き換える', async () => {
    const { result } = await renderWithTree()
    mockReadDirectory.mockResolvedValueOnce(structuredClone(treeB))
    await act(async () => {
      await result.current.refreshTreeQuietly()
    })
    expect(result.current.fileTree).toEqual(treeB)
  })

  it('読み込みの失敗 → reportTreeLoad を呼ばず、投げず、前のツリーを残す(L-002)', async () => {
    const { result, reportTreeLoad } = await renderWithTree()
    const before = result.current.fileTree
    vi.mocked(reportTreeLoad).mockClear()
    mockReadDirectory.mockRejectedValueOnce(new Error('read failed'))
    await act(async () => {
      await expect(result.current.refreshTreeQuietly()).resolves.toBeUndefined()
    })
    expect(reportTreeLoad).not.toHaveBeenCalled()
    expect(result.current.fileTree).toBe(before)
  })

  it('走査中(beginTreeWrite が null) → 読まない', async () => {
    const { result } = renderOperations({ beginTreeWrite: () => null })
    await act(async () => {
      await result.current.refreshTreeQuietly()
    })
    expect(mockReadDirectory).not.toHaveBeenCalled()
  })

  it('比べる相手は完了の時点の最新のツリー(読む間に置き換わったツリーと同じなら、その参照を保つ。L-040)', async () => {
    const { result } = await renderWithTree()
    const quiet = deferred<FileTreeNode[]>()
    mockReadDirectory.mockReturnValueOnce(quiet.promise)
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.refreshTreeQuietly()
    })
    const replaced = structuredClone(treeB)
    act(() => result.current.setFileTree(replaced))
    await act(async () => {
      quiet.resolve(structuredClone(treeB))
      await pending
    })
    expect(result.current.fileTree).toBe(replaced)
  })

  it('手動の読み直しの途中に静かな読み直しを 2 回頼む → 手動はツリーを反映して true を返し、静かな読み直しは手動の後に 1 回だけ走る', async () => {
    const { result } = await renderWithTree()
    mockReadDirectory.mockClear()
    const manual = deferred<FileTreeNode[]>()
    mockReadDirectory.mockReturnValueOnce(manual.promise)
    let refreshed: Promise<boolean> = Promise.resolve(false)
    act(() => {
      refreshed = result.current.refreshTree()
    })
    await act(async () => {
      await result.current.refreshTreeQuietly()
      await result.current.refreshTreeQuietly()
    })
    // 手動の途中は読まない(世代を進めて手動の結果を古くしない)
    expect(mockReadDirectory).toHaveBeenCalledOnce()
    mockReadDirectory.mockResolvedValue(structuredClone(treeB))
    let applied = false
    await act(async () => {
      manual.resolve(structuredClone(treeA))
      applied = await refreshed
    })
    expect(applied).toBe(true)
    await waitFor(() => expect(result.current.fileTree).toEqual(treeB))
    expect(mockReadDirectory).toHaveBeenCalledTimes(2)
  })

  it('手動の読み直しが失敗しても → 静かな読み直しは手動の後に 1 回走る(L-180)', async () => {
    const { result } = await renderWithTree()
    mockReadDirectory.mockClear()
    const manual = deferred<FileTreeNode[]>()
    mockReadDirectory.mockReturnValueOnce(manual.promise)
    let refreshed: Promise<boolean> = Promise.resolve(false)
    act(() => {
      refreshed = result.current.refreshTree()
    })
    await act(async () => {
      await result.current.refreshTreeQuietly()
    })
    mockReadDirectory.mockResolvedValue(structuredClone(treeB))
    await act(async () => {
      manual.reject(new Error('read failed'))
      await refreshed.catch(() => undefined)
    })
    await waitFor(() => expect(result.current.fileTree).toEqual(treeB))
    expect(mockReadDirectory).toHaveBeenCalledTimes(2)
  })

  it('静かな読み直しの途中に手動の読み直しが始まる → 手動が勝ち、遅れて届いた静かな結果は捨てる', async () => {
    const { result } = await renderWithTree()
    const quiet = deferred<FileTreeNode[]>()
    mockReadDirectory.mockReturnValueOnce(quiet.promise)
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.refreshTreeQuietly()
    })
    mockReadDirectory.mockResolvedValueOnce(structuredClone(treeB))
    await act(async () => {
      await result.current.refreshTree()
    })
    await act(async () => {
      quiet.resolve([{ name: 'stale.ts', path: '/project/stale.ts', type: 'file' }])
      await pending
    })
    expect(result.current.fileTree).toEqual(treeB)
  })
})
```

ファイルの先頭の import を `import { renderHook, act, waitFor } from '@testing-library/react'` にする（`waitFor` を足す）

- [ ] **Step 3: 失敗するテストを書く（useFileSystem）**

`src/renderer/src/hooks/__tests__/useFileSystem.test.ts` の `it('フォルダ確定後の取り直しが失敗しても openFolder を reject させない', …)` の前に足す:

```ts
  it('走査の後のやり直しの途中に静かな読み直しを頼んでも、やり直しは反映し(applied)、走査の失敗のエラーを消す', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockCreateFile.mockResolvedValue(undefined)
    const initial: FileTreeNode[] = [{ name: 'a.ts', path: '/project/a.ts', type: 'file' }]
    const afterCreate: FileTreeNode[] = [
      ...initial,
      { name: 'b.ts', path: '/project/b.ts', type: 'file' }
    ]
    mockReadDirectory.mockResolvedValue(initial)
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // 2 回目のフォルダ走査を失敗させる(失敗の経路は setError の後に、抑止したやり直しを手動で行う)
    let rejectScan: (err: Error) => void = () => {}
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((_resolve, reject) => {
          rejectScan = reject
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    // 走査中にファイル作成が成功する(再読込は抑止される)
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    // 走査の後のやり直しの読み込みを止めておく
    let resolveRetry: (tree: FileTreeNode[]) => void = () => {}
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveRetry = resolve
        })
    )
    await act(async () => {
      rejectScan(new Error('走査失敗'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.error).not.toBeNull()
    const readsBeforeQuiet = mockReadDirectory.mock.calls.length
    // やり直しの途中に静かな読み直しが届く(手動を追い越さない)
    await act(async () => {
      await result.current.refreshTreeQuietly()
    })
    expect(mockReadDirectory.mock.calls.length).toBe(readsBeforeQuiet)
    mockReadDirectory.mockResolvedValue(afterCreate)
    await act(async () => {
      resolveRetry(afterCreate)
      await folderPromise
    })
    expect(result.current.fileTree).toEqual(afterCreate)
    expect(result.current.error).toBeNull()
  })

  it('isFolderScanPending → 走査の間だけ true', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    let resolveScan: (tree: FileTreeNode[]) => void = () => {}
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveScan = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem())
    expect(result.current.isFolderScanPending()).toBe(false)
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    expect(result.current.isFolderScanPending()).toBe(true)
    await act(async () => {
      resolveScan([])
      await folderPromise
    })
    expect(result.current.isFolderScanPending()).toBe(false)
  })
```

- [ ] **Step 4: 失敗するテストを書く（指示ファイルの作成）**

`src/renderer/src/hooks/__tests__/useAgentInstructionFiles.quietReload.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'
import type { UseAgentInstructionFilesOptions } from '../useAgentInstructionFiles'

vi.mock('../../lib/fileSystemApi')
vi.mock('../../lib/agentInstructionsApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import * as agentInstructionsApi from '../../lib/agentInstructionsApi'
import { useFileSystem } from '../useFileSystem'
import { useAgentInstructionFiles } from '../useAgentInstructionFiles'

// 実物の useFileSystem と節の hook を一緒に描画し、作成の後の読み直し(手動)の途中に静かな読み直しが届いても、
// 作成したファイルが開くことを確かめる(設計書 2026-11-08「ツリーの静かな読み直し」の (a))
const claudeNode: FileTreeNode = { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' }
const getGlobalStatus: UseAgentInstructionFilesOptions['getGlobalStatus'] = async () => ({
  kind: 'missing',
  displayPath: '~/.claude/CLAUDE.md'
})
const createGlobalFile: UseAgentInstructionFilesOptions['createGlobalFile'] = async () => ({
  ok: true
})

function useCombined(): {
  fs: ReturnType<typeof useFileSystem>
  files: ReturnType<typeof useAgentInstructionFiles>
} {
  const fs = useFileSystem({ onConfirm: () => true })
  const files = useAgentInstructionFiles({
    folderPath: fs.folderPath,
    fileTree: fs.fileTree,
    cliKind: 'claude',
    createFile: fs.createAgentInstructionFile,
    openFile: fs.selectFile,
    refreshTree: fs.refreshTree,
    getGlobalStatus,
    createGlobalFile
  })
  return { fs, files }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('指示ファイルの作成と静かな読み直し', () => {
  it('作成の後の読み直しの途中に静かな読み直しを頼んでも → 作成したファイルが開き、開けなかった文言は出ない', async () => {
    vi.mocked(fileSystemApi.openFolder).mockResolvedValue('/p')
    vi.mocked(fileSystemApi.readDirectory).mockResolvedValue([])
    vi.mocked(fileSystemApi.readFileContent).mockResolvedValue('# 指示\n')
    vi.mocked(agentInstructionsApi.createAgentInstructionFile).mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useCombined())
    await act(async () => {
      await result.current.fs.openFolder()
    })
    let resolveReload: (tree: FileTreeNode[]) => void = () => {}
    vi.mocked(fileSystemApi.readDirectory).mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveReload = resolve
        })
    )
    const readsBefore = vi.mocked(fileSystemApi.readDirectory).mock.calls.length
    let creating: Promise<void> = Promise.resolve()
    await act(async () => {
      creating = result.current.files.create(result.current.files.rows[0])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // 作成の後の読み直し(手動)が始まっている
    expect(vi.mocked(fileSystemApi.readDirectory).mock.calls.length).toBe(readsBefore + 1)
    await act(async () => {
      await result.current.fs.refreshTreeQuietly()
    })
    vi.mocked(fileSystemApi.readDirectory).mockResolvedValue([claudeNode])
    await act(async () => {
      resolveReload([claudeNode])
      await creating
    })
    expect(fileSystemApi.readFileContent).toHaveBeenCalledWith('/p/CLAUDE.md')
    expect(result.current.files.message).toBeNull()
  })
})
```

（`rows[0]` は claude の `CLAUDE.md` の行。`create` の引数の型・`message` の名前は `useAgentInstructionFiles.test.ts` の既存のテストと同じ）

- [ ] **Step 5: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.quietReload.test.ts`
Expected: FAIL（`refreshTreeQuietly`・`isFolderScanPending` が無い）

- [ ] **Step 6: `useFileTreeOperations` を実装する**

`src/renderer/src/hooks/useFileTreeOperations.ts`:

1. import を直す: `import { useRef, useState } from 'react'`。`import { isSameFileTree } from '../lib/fileTreeEquality'` を足す
2. `interface FileTreeOperationsState` の `refreshTree` の後に足す:

```ts
  /**
   * ツリーを静かに読み直す(監視の通知・フォーカスの復帰。設計書 2026-11-08)。内容が同じなら置き換えず、失敗は表示せず前のツリーを残す。
   * 手動の読み直しの途中なら読まずに、手動の後に 1 回だけ読み直す。投げない
   */
  refreshTreeQuietly: () => Promise<void>
```

3. `interface FileTreeOperationsState` の前に足す:

```ts
interface ReloadTreeOptions {
  /** 静かに読み直す(内容が同じなら置き換えない・失敗を表示しない・手動を追い越さない) */
  quiet?: boolean
}
```

4. 今の `reloadTree`（104〜131 行。コメントを含む）と `refreshTree` を次に置き換える:

```ts
  // 実行中の手動の読み直しの数と、その間に届いた静かな読み直しの印(手動の後に 1 回だけ走らせる)。
  // 静かな読み直しも beginTreeWrite で世代を進めるため、手動の途中で走らせると手動の結果が古くなり、手動の呼び出し元
  // (指示ファイルの作成・走査の後のやり直し)が戻り値の null を失敗として扱ってしまう(設計書 2026-11-08 の (a))
  const manualReloadsInFlightRef = useRef(0)
  const quietAfterManualRef = useRef(false)

  // fs:readDirectory はルートフォルダしか受け付けないため、ツリー更新はルートからの
  // 全再読込で行う(木は MAX_DEPTH=5 で小さく、部分更新の複雑さに見合わない)
  // 1 回読んで反映する。反映したらそのツリー、反映しなかった(走査中・古い結果・フォルダが無い・静かな失敗)ら null
  const readTreeOnce = async (quiet: boolean): Promise<FileTreeNode[] | null> => {
    // フォルダ走査中は触らない。権威あるツリーはフォルダ読み込み側が書く(走査の後に手動でやり直す)
    const isLatestWrite = beginTreeWrite()
    if (isLatestWrite === null) return null
    // クロージャではなく「読み込む時点」のフォルダを見る。CRUD の完了が遅れると
    // クロージャの folderPath は切替前のものになり、旧フォルダを読んでしまう
    const target = getFolderPath()
    if (target === null) return null
    // 後発の読み込み(フォルダ読み込みを含む)が始まっていたら反映しない。
    // フォルダが同じでも、古いスナップショットで新しい結果を上書きしてしまう
    const isStale = (): boolean => !isLatestWrite() || getFolderPath() !== target
    try {
      const tree = await fileSystemApi.readDirectory(target)
      if (isStale()) return null
      if (quiet) {
        // await の前のクロージャの fileTree ではなく、最新のツリーと比べる(読む間に置き換わっていることがある。L-040)
        setFileTree((prev) => (isSameFileTree(prev, tree) ? prev : tree))
      } else {
        setFileTree(tree)
      }
      reportTreeLoad(null)
      return tree
    } catch (err) {
      // 古い再読込の失敗を、現在の画面に出さない。静かな読み直しの失敗も出さない(前のツリーと表示を残す。L-002)
      if (isStale() || quiet) return null
      reportTreeLoad(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  // ツリーを読み直して反映する。反映したらそのツリー、反映しなかったら null。
  // 手動の読み込みの失敗は reportTreeLoad の後に投げ直す(refreshTree と指示ファイルの作成が使う)。静かな読み直しは投げない
  const reloadTree = async ({ quiet = false }: ReloadTreeOptions = {}): Promise<
    FileTreeNode[] | null
  > => {
    if (quiet) {
      if (manualReloadsInFlightRef.current > 0) {
        quietAfterManualRef.current = true
        return null
      }
      return readTreeOnce(true)
    }
    manualReloadsInFlightRef.current += 1
    try {
      return await readTreeOnce(false)
    } finally {
      // 成功・失敗・古い結果・早期の return のどれでも減らす。最後の手動が終わったら、届いていた静かな読み直しを 1 回だけ
      // 走らせる(待たない。手動の戻り値を遅らせない)
      manualReloadsInFlightRef.current -= 1
      if (manualReloadsInFlightRef.current === 0 && quietAfterManualRef.current) {
        quietAfterManualRef.current = false
        void reloadTree({ quiet: true }).catch(() => undefined)
      }
    }
  }

  const refreshTree = async (): Promise<boolean> => (await reloadTree()) !== null

  const refreshTreeQuietly = async (): Promise<void> => {
    await reloadTree({ quiet: true })
  }
```

5. 返り値のオブジェクトの `refreshTree,` の後に `refreshTreeQuietly,` を足す（`createAgentInstructionFile` に渡す `reloadTree` は今のまま。引数無しで呼ばれるので手動）

- [ ] **Step 7: `useFileSystem` を実装する**

`src/renderer/src/hooks/useFileSystem.ts`:

1. `interface FileSystemState` の `refreshTree: () => Promise<boolean>` の宣言の後に足す:

```ts
  /** ルートからファイルツリーを静かに読み直す(監視の通知・フォーカスの復帰。useFileTreeOperations.refreshTreeQuietly)。投げない */
  refreshTreeQuietly: () => Promise<void>
  /** フォルダの走査中か。走査中は main の許可が新しいフォルダ、画面が前のフォルダのままなので、静かな取り直しを反映しない */
  isFolderScanPending: () => boolean
```

2. `useFileTreeOperations({ … })` の分割代入の `refreshTree,` の後に `refreshTreeQuietly,` を足す
3. 返り値のオブジェクトの `refreshTree,` の後に足す:

```ts
    refreshTreeQuietly,
    isFolderScanPending: () => pendingFolderOpenRef.current > 0,
```

- [ ] **Step 8: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useFileSystem.folderOpen.test.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.quietReload.test.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: PASS

- [ ] **Step 9: 実装を戻すと落ちることを確かめる**

1. `reloadTree` の `if (manualReloadsInFlightRef.current > 0) { … return null }` の 4 行を一時的に消して走らせ、`手動の読み直しの途中に静かな読み直しを 2 回頼む …`・`useFileSystem.test.ts` の新しい 1 件・`useAgentInstructionFiles.quietReload.test.ts` が落ちることを確かめてから戻す
2. `setFileTree((prev) => …)` を一時的に `setFileTree(isSameFileTree(fileTree, tree) ? fileTree : tree)` に変えて走らせ、`比べる相手は完了の時点の最新のツリー …` が落ちることを確かめてから戻す
3. `catch` の `|| quiet` を一時的に消して走らせ、`読み込みの失敗 → reportTreeLoad を呼ばず …` が落ちることを確かめてから戻す

- [ ] **Step 10: 検証**

Run: `npx eslint src/renderer/src/hooks/useFileTreeOperations.ts src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.quietReload.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 9: git status の静かな取り直し（`useGitStatus`）

設計書: 3 章「git status の静かな取り直し」、2 章「フォルダの走査中は、git status と diff の静かな取り直しをしない」。知見: L-001（受け入れたかを真偽値で返す）、L-002、L-037（走査中の結果を前のフォルダの画面に出さない）、L-040（番号の共有・`inheritsLoud`・完了の時点の控えとの比べ）、L-180（成功と失敗の両方で走査中を捨てる）。

**Files:**
- Modify: `src/renderer/src/hooks/useGitStatus.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`（`useGitStatus` の呼び出し）
- Test: `src/renderer/src/hooks/__tests__/useGitStatus.test.ts`（既存の呼び出しを直し、`describe` を足す）
- Test: `src/renderer/src/hooks/__tests__/useAppState.test.ts`（`useFileSystem` の既定のモックと、`useGitStatus` の呼び出しの検証を直す）

**Interfaces:**
- Consumes: `isSameGitStatus`（Task 7）、`useFileSystem().isFolderScanPending: () => boolean`（Task 8）、`useLatestRef`（既存）
- Produces:
  - `export interface GitStatusOptions { isFolderScanPending: () => boolean }`
  - `export function useGitStatus(folderPath: string | null, options: GitStatusOptions): GitStatusState`
  - `GitStatusState` に `refreshGitStatusQuietly: () => Promise<boolean>`（受け入れたら true。投げない）と `wasGitStatusSetQuietly: () => boolean`（今の `gitStatus` を静かな取得が置いたか）。Task 10・Task 11 が使う

- [ ] **Step 1: 既存のテストの呼び出しを直す**

`src/renderer/src/hooks/__tests__/useGitStatus.test.ts` の `const mockResult` の後に足す:

```ts
// 走査中でない(既存のテストの前提)
const notScanning: GitStatusOptions = { isFolderScanPending: () => false }
```

import に `import type { GitStatusOptions } from '../useGitStatus'` を足す。ファイルの中の `useGitStatus(null)`・`useGitStatus('/project')`・`useGitStatus(path)`・`useGitStatus('/project-a')` などの呼び出しを、すべて第 2 引数に `notScanning` を渡す形（例: `useGitStatus(path, notScanning)`）に直す。直す前と後に `grep -c "useGitStatus(" src/renderer/src/hooks/__tests__/useGitStatus.test.ts` を数え、直した後に `grep -n "useGitStatus(" src/renderer/src/hooks/__tests__/useGitStatus.test.ts | grep -v notScanning` が 0 件になることを確かめる（L-199）

- [ ] **Step 2: 失敗するテストを書く**

同じファイルの末尾に足す:

```ts
describe('静かな取り直し(refreshGitStatusQuietly)', () => {
  const changed: GitStatusResult = {
    ...mockResult,
    files: [{ path: 'a.txt', index: ' ', workingDir: 'M' }]
  }

  function deferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (err: Error) => void
  } {
    let resolve: (value: T) => void = () => undefined
    let reject: (err: Error) => void = () => undefined
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  async function renderLoaded(
    options: GitStatusOptions = notScanning
  ): Promise<{ current: ReturnType<typeof useGitStatus> }> {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result } = renderHook(() => useGitStatus('/project', options))
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))
    return result
  }

  it('取得の間 → gitLoading は偽のまま、前のエラーを消さない。取れたら → エラーを消す', async () => {
    const result = await renderLoaded()
    mockGetGitStatus.mockRejectedValueOnce(new Error('loud failed'))
    await act(async () => {
      await result.current.refreshGitStatus()
    })
    expect(result.current.gitError?.message).toBe('loud failed')
    const pending = deferred<GitStatusResult>()
    mockGetGitStatus.mockReturnValueOnce(pending.promise)
    let accepted: Promise<boolean> = Promise.resolve(false)
    act(() => {
      accepted = result.current.refreshGitStatusQuietly()
    })
    expect(result.current.gitLoading).toBe(false)
    expect(result.current.gitError?.message).toBe('loud failed')
    await act(async () => {
      pending.resolve(changed)
      await accepted
    })
    await expect(accepted).resolves.toBe(true)
    expect(result.current.gitError).toBeNull()
    expect(result.current.gitStatus).toEqual(changed)
  })

  it('同じ内容 → 置き換えない(参照が同じ)。受け入れたので true。マウント時に作った関数でも完了の時点の控えと比べる(L-040)', async () => {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result } = renderHook(() => useGitStatus('/project', notScanning))
    // gitStatus が null の時点の関数(クロージャの gitStatus と比べると、別物として置き換えてしまう)
    const quietAtMount = result.current.refreshGitStatusQuietly
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))
    const before = result.current.gitStatus
    mockGetGitStatus.mockResolvedValueOnce({ ...mockResult })
    let accepted = false
    await act(async () => {
      accepted = await quietAtMount()
    })
    expect(accepted).toBe(true)
    expect(result.current.gitStatus).toBe(before)
    expect(result.current.wasGitStatusSetQuietly()).toBe(false)
  })

  it('違う内容 → 置き換え、wasGitStatusSetQuietly が真。その後の通常の取得 → 偽に戻る', async () => {
    const result = await renderLoaded()
    mockGetGitStatus.mockResolvedValueOnce(changed)
    await act(async () => {
      await result.current.refreshGitStatusQuietly()
    })
    expect(result.current.gitStatus).toEqual(changed)
    expect(result.current.wasGitStatusSetQuietly()).toBe(true)
    mockGetGitStatus.mockResolvedValueOnce(mockResult)
    await act(async () => {
      await result.current.refreshGitStatus()
    })
    expect(result.current.wasGitStatusSetQuietly()).toBe(false)
  })

  it('失敗 → 前の status とエラーを残し、false を返し、投げない(L-002)', async () => {
    const result = await renderLoaded()
    mockGetGitStatus.mockRejectedValueOnce(new Error('loud failed'))
    await act(async () => {
      await result.current.refreshGitStatus()
    })
    const before = result.current.gitStatus
    mockGetGitStatus.mockRejectedValueOnce(new Error('quiet failed'))
    let accepted = true
    await act(async () => {
      accepted = await result.current.refreshGitStatusQuietly()
    })
    expect(accepted).toBe(false)
    expect(result.current.gitStatus).toBe(before)
    expect(result.current.gitError?.message).toBe('loud failed')
  })

  it.each<[string, (pending: ReturnType<typeof deferred<GitStatusResult>>) => void, (r: ReturnType<typeof useGitStatus>) => void]>([
    [
      '成功',
      (pending) => pending.resolve(changed),
      (r) => expect(r.gitStatus).toEqual(changed)
    ],
    [
      '失敗',
      (pending) => pending.reject(new Error('quiet failed')),
      (r) => expect(r.gitError?.message).toBe('quiet failed')
    ]
  ])('通常の取得の途中で静かな取得が追い越して%s → 完了で gitLoading を下ろし、結果を出す。遅れた通常の結果は捨てる', async (_label, finish, check) => {
    const result = await renderLoaded()
    const loud = deferred<GitStatusResult>()
    const quiet = deferred<GitStatusResult>()
    mockGetGitStatus.mockReturnValueOnce(loud.promise).mockReturnValueOnce(quiet.promise)
    let loudDone: Promise<void> = Promise.resolve()
    let quietDone: Promise<boolean> = Promise.resolve(false)
    act(() => {
      loudDone = result.current.refreshGitStatus()
    })
    expect(result.current.gitLoading).toBe(true)
    act(() => {
      quietDone = result.current.refreshGitStatusQuietly()
    })
    await act(async () => {
      finish(quiet)
      await quietDone
    })
    expect(result.current.gitLoading).toBe(false)
    check(result.current)
    const afterQuiet = result.current.gitStatus
    await act(async () => {
      loud.resolve({ ...mockResult, branch: 'stale' })
      await loudDone
    })
    expect(result.current.gitStatus).toBe(afterQuiet)
  })

  it('静かな取得が通常の取得に追い越された → 反映せず false', async () => {
    const result = await renderLoaded()
    const quiet = deferred<GitStatusResult>()
    mockGetGitStatus.mockReturnValueOnce(quiet.promise).mockResolvedValueOnce(changed)
    let quietDone: Promise<boolean> = Promise.resolve(true)
    act(() => {
      quietDone = result.current.refreshGitStatusQuietly()
    })
    await act(async () => {
      await result.current.refreshGitStatus()
    })
    let accepted = true
    await act(async () => {
      quiet.resolve({ ...mockResult, branch: 'stale' })
      accepted = await quietDone
    })
    expect(accepted).toBe(false)
    expect(result.current.gitStatus).toEqual(changed)
  })

  it.each<[string, (pending: ReturnType<typeof deferred<GitStatusResult>>) => void]>([
    ['成功', (pending) => pending.resolve(changed)],
    ['失敗', (pending) => pending.reject(new Error('quiet failed'))]
  ])('取得の間にフォルダの走査が始まって%s → 結果も失敗も反映せず false(L-037)', async (_label, finish) => {
    let scanning = false
    const result = await renderLoaded({ isFolderScanPending: () => scanning })
    const before = result.current.gitStatus
    const quiet = deferred<GitStatusResult>()
    mockGetGitStatus.mockReturnValueOnce(quiet.promise)
    let quietDone: Promise<boolean> = Promise.resolve(true)
    act(() => {
      quietDone = result.current.refreshGitStatusQuietly()
    })
    scanning = true
    let accepted = true
    await act(async () => {
      finish(quiet)
      accepted = await quietDone
    })
    expect(accepted).toBe(false)
    expect(result.current.gitStatus).toBe(before)
    expect(result.current.gitError).toBeNull()
  })

  it('通常の取得を引き継いだ静かな取得が走査中に完了 → 反映しないが gitLoading は下ろす', async () => {
    let scanning = false
    const result = await renderLoaded({ isFolderScanPending: () => scanning })
    const loud = deferred<GitStatusResult>()
    const quiet = deferred<GitStatusResult>()
    mockGetGitStatus.mockReturnValueOnce(loud.promise).mockReturnValueOnce(quiet.promise)
    act(() => {
      void result.current.refreshGitStatus()
    })
    let quietDone: Promise<boolean> = Promise.resolve(true)
    act(() => {
      quietDone = result.current.refreshGitStatusQuietly()
    })
    scanning = true
    await act(async () => {
      quiet.resolve(changed)
      await quietDone
    })
    expect(result.current.gitLoading).toBe(false)
    expect(result.current.gitStatus).toEqual(mockResult)
  })

  it('フォルダが null → 取得せず false', async () => {
    const { result } = renderHook(() => useGitStatus(null, notScanning))
    let accepted = true
    await act(async () => {
      accepted = await result.current.refreshGitStatusQuietly()
    })
    expect(accepted).toBe(false)
    expect(mockGetGitStatus).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useGitStatus.test.ts`
Expected: FAIL（`refreshGitStatusQuietly` が無い。既存のテストは第 2 引数を無視して通る）

- [ ] **Step 4: 実装する**

`src/renderer/src/hooks/useGitStatus.ts` を次にする:

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import { isSameGitStatus } from '../lib/gitStatusEquality'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

export interface GitStatusOptions {
  /** フォルダの走査中か(useFileSystem.isFolderScanPending)。走査中に完了した静かな取得は反映しない */
  isFolderScanPending: () => boolean
}

interface GitStatusState {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  refreshGitStatus: () => Promise<void>
  /**
   * 静かに取り直す(監視の通知・フォーカスの復帰。設計書 2026-11-08)。gitLoading を立てず、gitError を消さず、内容が同じなら置き換えない。
   * 受け入れた(完了の時点で最新で、走査中でなく、成功した。同じで置き換えなかった場合も含む)なら true。投げない
   */
  refreshGitStatusQuietly: () => Promise<boolean>
  /** 今の gitStatus を静かな取得が置いたか(エージェントの変更の一覧を静かに取り直すかの判断に使う) */
  wasGitStatusSetQuietly: () => boolean
}

interface GitStatusSetters {
  setGitStatus: (status: GitStatusResult | null) => void
  setGitLoading: (loading: boolean) => void
  setGitError: (error: Error | null) => void
}

// 描画をまたいで保つ控え(取得の番号は通常と静かで共有し、後から始まった取得が勝つ。L-040)
interface GitStatusTracking {
  latestRequestId: number
  /** 最後に setGitStatus へ渡した値(静かな取得は、await の前のクロージャではなく完了の時点のこの値と比べる) */
  latestStatus: GitStatusResult | null
  /** 今の gitStatus を静かな取得が置いたか */
  setQuietly: boolean
  /** 通常の取得の途中か(gitLoading を下ろす役目が残っているか) */
  loudPending: boolean
}

function applyStatus(
  setters: GitStatusSetters,
  tracking: GitStatusTracking,
  status: GitStatusResult | null,
  quiet: boolean
): void {
  tracking.setQuietly = quiet
  tracking.latestStatus = status
  setters.setGitStatus(status)
}

// status を取り直す。後から始まった取得があれば、古い取得の結果・失敗・読み込み中の解除は反映しない
// (latestRequestId で判定する)。useGitHistory の fetchGitHistoryData と同じく、setState を呼ぶ処理を
// フック本体の外に置く(react-hooks/set-state-in-effect に、effect 内から呼ぶ関数を正しく認識させる)
async function fetchGitStatus(
  folderPath: string | null,
  setters: GitStatusSetters,
  tracking: GitStatusTracking
): Promise<void> {
  const requestId = ++tracking.latestRequestId
  if (folderPath === null) {
    tracking.loudPending = false
    applyStatus(setters, tracking, null, false)
    setters.setGitLoading(false)
    setters.setGitError(null)
    return
  }
  tracking.loudPending = true
  setters.setGitLoading(true)
  setters.setGitError(null)
  try {
    const result = await gitApi.getGitStatus()
    if (requestId === tracking.latestRequestId) applyStatus(setters, tracking, result, false)
  } catch (err) {
    if (requestId === tracking.latestRequestId) setters.setGitError(toError(err))
  } finally {
    if (requestId === tracking.latestRequestId) {
      setters.setGitLoading(false)
      tracking.loudPending = false
    }
  }
}

// 静かに取り直す。通常の取得の途中に始まったら、その役目(gitLoading を下ろす・失敗を出す)を引き継ぐ(inheritsLoud)
async function fetchGitStatusQuietly(
  folderPath: string | null,
  setters: GitStatusSetters,
  tracking: GitStatusTracking,
  isFolderScanPending: () => boolean
): Promise<boolean> {
  // フォルダの切り替えは今の effect が扱う
  if (folderPath === null) return false
  const requestId = ++tracking.latestRequestId
  const inheritsLoud = tracking.loudPending
  const finishLoud = (): void => {
    if (!inheritsLoud) return
    setters.setGitLoading(false)
    tracking.loudPending = false
  }
  try {
    const result = await gitApi.getGitStatus()
    if (requestId !== tracking.latestRequestId) return false
    // 取得の間に走査が始まったら、main の許可は新しいフォルダで画面は前のフォルダのまま。結果を出さない(L-037)
    if (isFolderScanPending()) {
      finishLoud()
      return false
    }
    // 同じなら置き換えない(参照を保ち、エージェントの変更の一覧・diff の連鎖を起こさない)
    if (!isSameGitStatus(tracking.latestStatus, result)) applyStatus(setters, tracking, result, true)
    // 取れたので、前の失敗の表示は古い
    setters.setGitError(null)
    finishLoud()
    return true
  } catch (err) {
    if (requestId !== tracking.latestRequestId) return false
    if (isFolderScanPending()) {
      finishLoud()
      return false
    }
    // 静かな失敗は出さない(前の status と表示を残す。L-002)。通常の取得を引き継いだときだけ出す
    if (inheritsLoud) setters.setGitError(toError(err))
    finishLoud()
    return false
  }
}

export function useGitStatus(
  folderPath: string | null,
  { isFolderScanPending }: GitStatusOptions
): GitStatusState {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<Error | null>(null)
  const trackingRef = useRef<GitStatusTracking>({
    latestRequestId: 0,
    latestStatus: null,
    setQuietly: false,
    loudPending: false
  })
  const isFolderScanPendingRef = useLatestRef(isFolderScanPending)

  const refreshGitStatus = useCallback(
    (): Promise<void> =>
      fetchGitStatus(folderPath, { setGitStatus, setGitLoading, setGitError }, trackingRef.current),
    [folderPath]
  )

  const refreshGitStatusQuietly = useCallback(
    (): Promise<boolean> =>
      fetchGitStatusQuietly(
        folderPath,
        { setGitStatus, setGitLoading, setGitError },
        trackingRef.current,
        () => isFolderScanPendingRef.current()
      ),
    [folderPath, isFolderScanPendingRef]
  )

  const wasGitStatusSetQuietly = useCallback((): boolean => trackingRef.current.setQuietly, [])

  // フォルダが切り替わった時点で、前のフォルダの status を捨てる。
  // 残したままにすると、新しいフォルダの取得が終わるまでの間、ソース管理パネルに
  // 前のフォルダのブランチ名とファイル一覧が「操作可能な状態で」表示される。
  // その間に「+」を押すと、前のフォルダのファイルパスが新しい allowedFolder に
  // 対して解決され、切替先の同名ファイルをステージしてしまう。
  // refreshGitStatus 内でクリアしないのは、同一フォルダの再取得
  // (stage/unstage/保存のたびに走る)まで巻き込むと、SourceControlPanel が
  // GitRepoView をアンマウントし、入力中のコミットメッセージが失われるため
  useOnChange(folderPath, () => {
    applyStatus({ setGitStatus, setGitLoading, setGitError }, trackingRef.current, null, false)
  })

  // フォルダが変わるたび(初回を含む)に取り直す。refreshGitStatus と同じ取得を、effect からは直接呼ぶ
  useEffect(() => {
    void fetchGitStatus(folderPath, { setGitStatus, setGitLoading, setGitError }, trackingRef.current)
  }, [folderPath])

  return {
    gitStatus,
    gitLoading,
    gitError,
    refreshGitStatus,
    refreshGitStatusQuietly,
    wasGitStatusSetQuietly
  }
}
```

- [ ] **Step 5: 組み立てを直す**

`src/renderer/src/hooks/useAppState.ts` の `const git = useGitStatus(fileSystem.folderPath)` を次にする:

```ts
  // 走査中は静かな git status の取得を反映しない(main の許可は新しいフォルダ、画面は前のフォルダのまま。設計書 2026-11-08)
  const git = useGitStatus(fileSystem.folderPath, {
    isFolderScanPending: fileSystem.isFolderScanPending
  })
```

`src/renderer/src/hooks/__tests__/useAppState.test.ts`:
- `mockUseFileSystem` の戻り値の型（`(): { … }`）に `isFolderScanPending?: () => boolean` と `refreshTreeQuietly?: () => Promise<void>` を足し、既定の戻り値のオブジェクト（`deleteEntry: vi.fn().mockResolvedValue(undefined)` の後）に `isFolderScanPending: vi.fn(() => false),`・`refreshTreeQuietly: vi.fn().mockResolvedValue(undefined)` を足す
- `it('useGitStatus を呼び出す（folderPath を引数に）', …)` の `expect(mockUseGitStatus).toHaveBeenCalledWith(null)` を次にする:

```ts
    const fileSystem = mockUseFileSystem.mock.results[0].value
    expect(mockUseGitStatus).toHaveBeenCalledWith(null, {
      isFolderScanPending: fileSystem.isFolderScanPending
    })
```

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useGitStatus.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS

- [ ] **Step 7: 実装を戻すと落ちることを確かめる**

1. `fetchGitStatusQuietly` の成功の側の `if (isFolderScanPending()) { … }` を一時的に消して走らせ、`取得の間にフォルダの走査が始まって成功` が落ちることを確かめてから戻す。失敗の側も同じく消して `…失敗` が落ちることを確かめてから戻す（L-180）
2. `isSameGitStatus(tracking.latestStatus, result)` を一時的に `isSameGitStatus(null, result)` に変えて、`同じ内容 → 置き換えない …` が落ちることを確かめてから戻す
3. `finishLoud` の中身を一時的に空にして、`通常の取得の途中で静かな取得が追い越して…` の 2 件が落ちる（`gitLoading` が真のまま）ことを確かめてから戻す

- [ ] **Step 8: 検証**

Run: `npx eslint src/renderer/src/hooks/useGitStatus.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useGitStatus.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 10: エージェントの変更の一覧の連鎖と、diff タブの静かな取り直しの固定

設計書: 3 章「エージェントの変更の一覧の連鎖」「diff タブ」（案 (a)）、4 章の連鎖・diff のテスト。知見: L-040、L-174（静かな経路を通ったことを引数で確かめる）。

**Files:**
- Modify: `src/renderer/src/hooks/useAgentChangesWiring.ts`（`AgentChangesWiringOptions`・151〜153 行の effect）
- Modify: `src/renderer/src/hooks/useAppState.ts`（`useAgentChangesWiring` に渡す）
- Test: `src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`（`makeOptions` に足し、1 件足す）
- Test: `src/renderer/src/hooks/__tests__/useDiffOperations.test.ts`（1 件足す。今の実装で通る固定のテスト）
- Test: `src/renderer/src/hooks/__tests__/useAppState.test.ts`・`useAppState.agent.test.ts`（`useGitStatus` のモックに既定を足す）

**Interfaces:**
- Consumes: `useGitStatus().wasGitStatusSetQuietly: () => boolean`（Task 9）、`useAgentChanges().refresh(options?: AgentChangesRefreshOptions)`（既存。`{ quiet: true }` で `isLoading` を立てない）、`useDiffOperations().refreshDiff(options?: DiffRefreshOptions)`（既存）
- Produces:
  - `AgentChangesWiringOptions` に `wasGitStatusSetQuietly: () => boolean`（省略できない）

- [ ] **Step 1: 失敗するテストを書く（連鎖）**

`src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts`:
- `makeOptions` の既定のオブジェクトの `refreshGitStatus: vi.fn(async () => undefined),` の後に `wasGitStatusSetQuietly: () => false,` を足す
- `describe('一覧を取り直す契機', …)` の `it('git status が無い間は取り直さず、…')` の後に足す:

```ts
    it('静かな取り直しが置いた git status → 一覧も静かに取り直す({ quiet: true })。通常の取得が置いたもの → 引数無し', () => {
      let setQuietly = true
      const { update, options } = setup(makeOptions({ wasGitStatusSetQuietly: () => setQuietly }))
      const refresh = options().recording.changes.refresh
      update({ gitStatus: gitStatusOf('main') })
      expect(refresh).toHaveBeenLastCalledWith({ quiet: true })
      setQuietly = false
      update({ gitStatus: gitStatusOf('dev') })
      expect(refresh).toHaveBeenLastCalledWith()
      expect(refresh).toHaveBeenCalledTimes(2)
    })
```

- [ ] **Step 2: 固定するテストを書く（diff）**

`src/renderer/src/hooks/__tests__/useDiffOperations.test.ts` の末尾に足す（今の `requestRefresh` と取得の effect の作りで通る。設計書 3 章「diff タブ」の (a) を固定する）:

```ts
describe('外の変更での静かな取り直し(git status の文字が変わる)', () => {
  it('同じ描画で status の文字が変わり refreshDiff({ quiet: true }) も頼まれる → 取得は 1 回で、届くまで前の内容を出したまま(読み込み中にしない)', async () => {
    const tab: DiffTabKey = { path: 'b.txt', kind: 'unstaged' }
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const before: GitFileStatus[] = [{ path: 'b.txt', index: ' ', workingDir: 'M' }]
    const after: GitFileStatus[] = [{ path: 'b.txt', index: 'M', workingDir: 'M' }]
    mockGetDiff.mockResolvedValue('OLD_DIFF')
    const { result, rerender } = renderHook(
      ({ files }: { files: GitFileStatus[] }) =>
        useDiffOperationsForTest(tab, refreshGitStatus, files),
      { initialProps: { files: before } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('OLD_DIFF'))
    let resolveNew: (value: string) => void = () => undefined
    mockGetDiff.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveNew = resolve
      })
    )
    const callsBefore = mockGetDiff.mock.calls.length
    act(() => {
      result.current.refreshDiff({ quiet: true })
      rerender({ files: after })
    })
    expect(mockGetDiff.mock.calls.length - callsBefore).toBe(1)
    expect(result.current.diffContent).toBe('OLD_DIFF')
    await act(async () => {
      resolveNew('NEW_DIFF')
    })
    expect(result.current.diffContent).toBe('NEW_DIFF')
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useDiffOperations.test.ts`
Expected: 連鎖の新しい 1 件が FAIL（`{ quiet: true }` で呼ばれない）。diff の新しい 1 件は PASS（固定のテスト）。型の検査では `wasGitStatusSetQuietly` が `AgentChangesWiringOptions` に無いことが `npm run typecheck` でエラーになる

- [ ] **Step 4: 実装する**

`src/renderer/src/hooks/useAgentChangesWiring.ts`:

1. `import { useLatestRef } from './useLatestRef'` を足す（無ければ）
2. `AgentChangesWiringOptions` の `refreshGitStatus: () => Promise<void>` の後に足す:

```ts
  /** 今の gitStatus を静かな取得が置いたか(useGitStatus.wasGitStatusSetQuietly)。真なら一覧も静かに取り直す */
  wasGitStatusSetQuietly: () => boolean
```

3. 分割代入の `refreshGitStatus,` の後に `wasGitStatusSetQuietly,` を足す
4. 今の effect:

```ts
  useEffect(() => {
    if (gitStatus !== null) void refreshAgentChanges()
  }, [gitStatus, refreshAgentChanges])
```

を次にする（直前のコメントの「git status の取り直し(Git の操作・保存・ソース管理の更新のボタンの後)」の後に「・監視の通知とフォーカスの復帰の静かな取り直し(静かに取る)」を足す）:

```ts
  // 静かな取り直しが置いた status なら、一覧も静かに取る(isLoading を立てない。設計書 2026-11-08)。最新の値を effect の中で読む
  const wasGitStatusSetQuietlyRef = useLatestRef(wasGitStatusSetQuietly)
  useEffect(() => {
    if (gitStatus === null) return
    if (wasGitStatusSetQuietlyRef.current()) void refreshAgentChanges({ quiet: true })
    else void refreshAgentChanges()
  }, [gitStatus, refreshAgentChanges, wasGitStatusSetQuietlyRef])
```

`src/renderer/src/hooks/useAppState.ts` の `useAgentChangesWiring({ … })` の `refreshGitStatus: git.refreshGitStatus,` の後に足す:

```ts
    wasGitStatusSetQuietly: git.wasGitStatusSetQuietly,
```

- [ ] **Step 5: `useAppState` のテストのモックに既定を足す**

`useAppState.test.ts`・`useAppState.agent.test.ts` の `useGitStatus` のモックは、テストごとの `mockReturnValue` に新しい 2 つが無い（`useAppState.test.ts` だけで 23 か所）。個々の `mockReturnValue` を直さず、モックの factory で既定を足す。両方のファイルの `vi.mock('../useGitStatus', () => ({ useGitStatus: mockUseGitStatus }))` を次に置き換える（一致しなければ失敗する置換で行う。L-199）:

```ts
// 静かな取り直しの 2 つは既定を足す(テストごとの mockReturnValue に書かなくてよいように。値を返したモックが優先)
vi.mock('../useGitStatus', () => ({
  useGitStatus: (...args: unknown[]): unknown => ({
    refreshGitStatusQuietly: async (): Promise<boolean> => true,
    wasGitStatusSetQuietly: (): boolean => false,
    ...(Reflect.apply(mockUseGitStatus, undefined, args) as object)
  })
}))
```

（呼び出しの検証〈`mockUseGitStatus` の `toHaveBeenCalledWith`〉は、引数をそのまま渡すので今のまま通る）

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Expected: PASS

- [ ] **Step 7: 実装を戻すと落ちることを確かめる**

1. 連鎖の effect を一時的に `if (gitStatus !== null) void refreshAgentChanges()` に戻して、新しい連鎖のテストが落ちることを確かめてから戻す
2. `useDiffOperations.ts` の `requestRefresh` の `if (mode === 'loud' || refreshModeRef.current === 'none') refreshModeRef.current = mode` を一時的に `refreshModeRef.current = 'loud'` に変えて、diff の新しいテストが落ちる（`diffContent` が null になる）ことを確かめてから戻す（固定のテストが空振りしていないこと。L-174）

- [ ] **Step 8: 検証**

Run: `npx eslint src/renderer/src/hooks/useAgentChangesWiring.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAgentChangesWiring.test.ts src/renderer/src/hooks/__tests__/useDiffOperations.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 11: 自動の取り直しの hook（`useFolderAutoRefresh`）・組み立て・App の統合のテスト

設計書: 3 章「自動の取り直し」、4 章の hook・配線のテスト。知見: L-108（cleanup とフォルダの切り替えで `reset`）、L-249（読み上げない）、L-399、L-469（「初回だけ」の ref を使わない。StrictMode で購読が残る）、L-701（`Promise.allSettled` に直接渡す）、L-008（外の変更の後の写しを取り直す）。

**決めた解釈:** 設計書は「スケジューラは `useRef` で 1 つだけ作る」と書く。描画の中で ref を読まないよう、`useExternalFileChanges.ts` の `coalescerRef.current ??= …` と同じく、最初に使う effect の中で作る（Task 6 の `useAgentChangesAutoRefresh` と同じ形）。

**Files:**
- Create: `src/renderer/src/hooks/useFolderAutoRefresh.ts`
- Test: `src/renderer/src/hooks/__tests__/useFolderAutoRefresh.test.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`（`useAgentChangesWiring(...)` の呼び出しの後、`return {` の前に呼ぶ）
- Test: `src/renderer/src/hooks/__tests__/useAppState.test.ts`・`useAppState.agent.test.ts`（`useFolderAutoRefresh` をモックにする。`useAppState.test.ts` に 1 件足す）
- Test（新規）: `src/renderer/src/components/__tests__/App.folderAutoRefresh.test.tsx`
- Test（前提が変わる既存のテスト）: `src/renderer/src/components/__tests__/App.agentChanges.test.tsx`（focus の後に `getAgentChangeDiff` を数える 3 件。Step 7）

**Interfaces:**
- Consumes: `createRefreshScheduler`・`RefreshScheduler`（Task 6）、`fileSystemApi.setFolderWatch`・`fileSystemApi.onFolderChange`（Task 5）、`useFileSystem().refreshTreeQuietly`・`isFolderScanPending`（Task 8）、`useGitStatus().refreshGitStatusQuietly`（Task 9）、`useDiffOperations().refreshDiff({ quiet: true })`（既存）
- Produces:
  - `export const FOLDER_AUTO_REFRESH_WAIT_MS = 50`・`export const FOLDER_AUTO_REFRESH_MAX_WAIT_MS = 300`
  - `export interface FolderAutoRefreshOptions { folderPath: string | null; refreshTreeQuietly: () => Promise<void>; refreshGitStatusQuietly: () => Promise<boolean>; refreshDiffQuietly: () => void; isFolderScanPending: () => boolean }`
  - `export function useFolderAutoRefresh(options: FolderAutoRefreshOptions): void`

- [ ] **Step 1: 失敗するテストを書く（hook）**

`src/renderer/src/hooks/__tests__/useFolderAutoRefresh.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode, createElement } from 'react'
import type { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import type { FolderChangeEvent } from '@shared/types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import {
  FOLDER_AUTO_REFRESH_MAX_WAIT_MS,
  FOLDER_AUTO_REFRESH_WAIT_MS,
  useFolderAutoRefresh
} from '../useFolderAutoRefresh'
import type { FolderAutoRefreshOptions } from '../useFolderAutoRefresh'

const mockSetFolderWatch = vi.mocked(fileSystemApi.setFolderWatch)
const mockOnFolderChange = vi.mocked(fileSystemApi.onFolderChange)
let folderListener: ((event: FolderChangeEvent) => void) | null = null
const unsubscribe = vi.fn()

type Mocked<K extends keyof FolderAutoRefreshOptions> = ReturnType<
  typeof vi.fn<Exclude<FolderAutoRefreshOptions[K], string | null>>
>

function setup(
  overrides: Partial<FolderAutoRefreshOptions> = {},
  wrapper?: (props: { children: ReactNode }) => ReactNode
): {
  options: FolderAutoRefreshOptions & {
    refreshTreeQuietly: Mocked<'refreshTreeQuietly'>
    refreshGitStatusQuietly: Mocked<'refreshGitStatusQuietly'>
    refreshDiffQuietly: Mocked<'refreshDiffQuietly'>
  }
  update: (next: Partial<FolderAutoRefreshOptions>) => void
  unmount: () => void
} {
  const options = {
    folderPath: '/repo',
    refreshTreeQuietly: vi.fn<FolderAutoRefreshOptions['refreshTreeQuietly']>(async () => undefined),
    refreshGitStatusQuietly: vi.fn<FolderAutoRefreshOptions['refreshGitStatusQuietly']>(
      async () => true
    ),
    refreshDiffQuietly: vi.fn<FolderAutoRefreshOptions['refreshDiffQuietly']>(),
    isFolderScanPending: () => false,
    ...overrides
  }
  let props: FolderAutoRefreshOptions = options
  const { rerender, unmount } = renderHook(
    (p: FolderAutoRefreshOptions) => useFolderAutoRefresh(p),
    { initialProps: props, wrapper }
  )
  return {
    options: options as never,
    update: (next) => {
      props = { ...props, ...next }
      rerender(props)
    },
    unmount
  }
}

const emitFolderChange = (event: FolderChangeEvent): void => {
  act(() => {
    folderListener?.(event)
  })
}

const focusWindow = (): void => {
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
}

const changeVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  folderListener = null
  mockSetFolderWatch.mockResolvedValue(undefined)
  mockOnFolderChange.mockImplementation((listener) => {
    folderListener = listener
    return unsubscribe
  })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useFolderAutoRefresh', () => {
  it('マウント → setFolderWatch(true)。アンマウント → setFolderWatch(false) と購読の解除', () => {
    const { unmount } = setup()
    expect(mockSetFolderWatch.mock.calls).toEqual([[true]])
    unmount()
    expect(mockSetFolderWatch.mock.calls).toEqual([[true], [false]])
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('treeChanged: true → 待ちの後にツリー・git status・diff を静かに取り直す', async () => {
    const { options } = setup()
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS - 1)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).toHaveBeenCalledOnce()
  })

  it('treeChanged: false → git status と diff だけ', async () => {
    const { options } = setup()
    emitFolderChange({ treeChanged: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).toHaveBeenCalledOnce()
  })

  it('ウィンドウの focus・visible → ツリー・git status・diff。hidden → 走らない', async () => {
    const { options } = setup()
    focusWindow()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    changeVisibility('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    changeVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledTimes(2)
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledTimes(2)
    expect(options.refreshDiffQuietly).toHaveBeenCalledTimes(2)
  })

  it('待ちの間の契機(focus と visibilitychange、通知)を 1 回にまとめ、tree は論理和', async () => {
    const { options } = setup()
    emitFolderChange({ treeChanged: false })
    focusWindow()
    changeVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
  })

  it('実行中の契機 → 終わった後の 1 回にまとめる', async () => {
    let finishTree: () => void = () => undefined
    const refreshTreeQuietly = vi.fn<FolderAutoRefreshOptions['refreshTreeQuietly']>(
      () =>
        new Promise<void>((resolve) => {
          finishTree = resolve
        })
    )
    const { options } = setup({ refreshTreeQuietly })
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    emitFolderChange({ treeChanged: true })
    emitFolderChange({ treeChanged: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    refreshTreeQuietly.mockResolvedValue(undefined)
    await act(async () => {
      finishTree()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledTimes(2)
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledTimes(2)
  })

  it('走査中 → ツリーは頼むが、git status と diff は呼ばない', async () => {
    const { options } = setup({ isFolderScanPending: () => true })
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    expect(options.refreshGitStatusQuietly).not.toHaveBeenCalled()
    expect(options.refreshDiffQuietly).not.toHaveBeenCalled()
  })

  it('git status の取得が受け入れられなかった(false。取得の間に走査が始まった等) → diff を呼ばない', async () => {
    const { options } = setup({
      refreshGitStatusQuietly: vi.fn<FolderAutoRefreshOptions['refreshGitStatusQuietly']>(
        async () => false
      )
    })
    emitFolderChange({ treeChanged: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).not.toHaveBeenCalled()
  })

  it('ツリーの取り直しが reject しても → git status と diff は走る(並べて allSettled で待つ)', async () => {
    const { options } = setup({
      refreshTreeQuietly: vi.fn<FolderAutoRefreshOptions['refreshTreeQuietly']>(async () => {
        throw new Error('unexpected')
      })
    })
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).toHaveBeenCalledOnce()
  })

  it('フォルダが null → 何もしない', async () => {
    const { options } = setup({ folderPath: null })
    emitFolderChange({ treeChanged: true })
    focusWindow()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
    expect(options.refreshGitStatusQuietly).not.toHaveBeenCalled()
  })

  it('フォルダの切り替え → 前のフォルダの予約を捨てる', async () => {
    const { options, update } = setup()
    emitFolderChange({ treeChanged: true })
    update({ folderPath: '/other' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
  })

  it('アンマウントの後 → 予約のタイマーが走らない(L-108)', async () => {
    const { options, unmount } = setup()
    emitFolderChange({ treeChanged: true })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
  })

  it('StrictMode の二重実行 → 監視の依頼は true → false → true の順で、購読が残る(L-469)', async () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
      createElement(StrictMode, null, children)
    const { options } = setup({}, wrapper)
    expect(mockSetFolderWatch.mock.calls).toEqual([[true], [false], [true]])
    emitFolderChange({ treeChanged: true })
    focusWindow()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useFolderAutoRefresh.test.ts`
Expected: FAIL（`../useFolderAutoRefresh` が無い）

- [ ] **Step 3: hook を実装する**

`src/renderer/src/hooks/useFolderAutoRefresh.ts`:

```ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import * as fileSystemApi from '../lib/fileSystemApi'
import { createRefreshScheduler } from '../lib/refreshScheduler'
import type { RefreshScheduler } from '../lib/refreshScheduler'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

// 開いているフォルダの自動の取り直し(設計書 2026-11-08「自動の取り直し」)。契機は main の監視の通知(fs:folderChange)と、
// ウィンドウの focus・visibilitychange(visible のときだけ。監視の取りこぼし・Linux の補い)。同じ瞬間に重なる契機を短い待ちで
// 1 回にまとめ(上限あり。L-399)、実行中の契機は終わった後の 1 回にまとめる。ツリー・git status・アクティブな diff タブを静かに取り直す
// (読み込み中の表示を出さず、内容が同じなら置き換えない)。走査中は git status と diff を取らない。読み上げない(L-249)。
// 開いているタブの中身(useExternalFileChanges)・記録中のエージェントの変更(useAgentChangesAutoRefresh)の購読は別に残す

/** 最後の契機からの待ち(同じ瞬間に重なる契機をまとめるだけの短い待ち) */
export const FOLDER_AUTO_REFRESH_WAIT_MS = 50
/** 最初の未処理の契機からの上限 */
export const FOLDER_AUTO_REFRESH_MAX_WAIT_MS = 300

export interface FolderAutoRefreshOptions {
  /** 開いているフォルダ(null の間は契機を捨てる。変わったら予約を捨てる) */
  folderPath: string | null
  /** useFileSystem.refreshTreeQuietly */
  refreshTreeQuietly: () => Promise<void>
  /** useGitStatus.refreshGitStatusQuietly(受け入れたら true) */
  refreshGitStatusQuietly: () => Promise<boolean>
  /** アクティブな diff タブを静かに取り直す(useDiffOperations.refreshDiff({ quiet: true })) */
  refreshDiffQuietly: () => void
  /** useFileSystem.isFolderScanPending */
  isFolderScanPending: () => boolean
}

interface FolderAutoRefreshRequest {
  /** ツリーも読み直すか(false なら git status と diff だけ) */
  tree: boolean
}

// git status を取り、受け入れられたときだけ diff を取る(取得の間に走査が始まって捨てたときは diff も取らない)
async function refreshGitAndDiff(options: RefObject<FolderAutoRefreshOptions>): Promise<void> {
  if (options.current.isFolderScanPending()) return
  if (await options.current.refreshGitStatusQuietly()) options.current.refreshDiffQuietly()
}

// ツリーと git status は並べて走らせ、allSettled で待つ(どちらも静かで、失敗は中で捨てる。配列に直接渡す。L-701)
async function runFolderAutoRefresh(
  { tree }: FolderAutoRefreshRequest,
  options: RefObject<FolderAutoRefreshOptions>
): Promise<void> {
  await Promise.allSettled([
    tree ? options.current.refreshTreeQuietly() : Promise.resolve(),
    refreshGitAndDiff(options)
  ])
}

// 最初に使う effect の中で作る(描画の中で ref を読まない。useExternalFileChanges の coalescerRef と同じ)
function ensureScheduler(
  schedulerRef: RefObject<RefreshScheduler<FolderAutoRefreshRequest> | null>,
  options: RefObject<FolderAutoRefreshOptions>
): RefreshScheduler<FolderAutoRefreshRequest> {
  schedulerRef.current ??= createRefreshScheduler<FolderAutoRefreshRequest>({
    waitMs: FOLDER_AUTO_REFRESH_WAIT_MS,
    maxWaitMs: FOLDER_AUTO_REFRESH_MAX_WAIT_MS,
    merge: (a, b) => ({ tree: a.tree || b.tree }),
    run: (request) => runFolderAutoRefresh(request, options),
    accepts: () => options.current.folderPath !== null
  })
  return schedulerRef.current
}

export function useFolderAutoRefresh(options: FolderAutoRefreshOptions): void {
  const optionsRef = useLatestRef(options)
  const schedulerRef = useRef<RefreshScheduler<FolderAutoRefreshRequest> | null>(null)

  // 監視を張るかだけを main へ送る(どのフォルダかは main が決め、フォルダの切り替えで張り直す)。
  // 毎回登録して毎回外す(「初回だけ」の ref を使わない。StrictMode の true → false → true は到着の順に処理される。L-469)
  useEffect(() => {
    void fileSystemApi.setFolderWatch(true).catch(() => undefined)
    return () => {
      void fileSystemApi.setFolderWatch(false).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const scheduler = ensureScheduler(schedulerRef, optionsRef)
    const unsubscribe = fileSystemApi.onFolderChange(({ treeChanged }) =>
      scheduler.schedule({ tree: treeChanged })
    )
    const onFocus = (): void => scheduler.schedule({ tree: true })
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') scheduler.schedule({ tree: true })
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      scheduler.reset()
    }
  }, [optionsRef])

  // 前のフォルダの予約を新しいフォルダで走らせない(フォルダを開いた直後は、ツリーの走査と git status の取得が今の経路で走る)
  useOnChange(options.folderPath, () => schedulerRef.current?.reset())
}
```

- [ ] **Step 4: hook のテストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useFolderAutoRefresh.test.ts`
Expected: PASS

- [ ] **Step 5: 組み立てる**

`src/renderer/src/hooks/useAppState.ts`:
- import に `import { useFolderAutoRefresh } from './useFolderAutoRefresh'` を足す
- `const agentChangesWiring = useAgentChangesWiring({ … })` の呼び出しの後、`return {` の前に足す:

```ts
  // 開いているフォルダの外の変更(エージェント・端末・外の git)の自動の反映(設計書 2026-11-08)。監視の通知とフォーカスの復帰で、
  // ツリー・git status・アクティブな diff タブを静かに取り直す。effect の順序を変えないため、ほかの hook の後で呼ぶ
  useFolderAutoRefresh({
    folderPath: fileSystem.folderPath,
    refreshTreeQuietly: fileSystem.refreshTreeQuietly,
    refreshGitStatusQuietly: git.refreshGitStatusQuietly,
    refreshDiffQuietly: () => diffOperations.refreshDiff({ quiet: true }),
    isFolderScanPending: fileSystem.isFolderScanPending
  })
```

`useAppState.test.ts`・`useAppState.agent.test.ts`: ほかの `vi.hoisted` のモックの並びに `const mockUseFolderAutoRefresh = vi.hoisted(() => vi.fn())` を足し、`vi.mock` の並びに `vi.mock('../useFolderAutoRefresh', () => ({ useFolderAutoRefresh: mockUseFolderAutoRefresh }))` を足す（`useFileSystem` のモックは静かな取り直しの関数を持たないことがあるため、hook の中身はここでは走らせない）。`useAppState.test.ts` の `it('useGitStatus を呼び出す（folderPath を引数に）', …)` の後に足す:

```ts
  it('useFolderAutoRefresh に、フォルダと、ツリー・git status・diff の静かな取り直しと、走査中かを渡す', () => {
    renderHook(() => useAppState())
    const fileSystem = mockUseFileSystem.mock.results[0].value
    const options = mockUseFolderAutoRefresh.mock.calls.at(-1)?.[0]
    expect(options).toMatchObject({
      folderPath: null,
      refreshTreeQuietly: fileSystem.refreshTreeQuietly,
      isFolderScanPending: fileSystem.isFolderScanPending,
      refreshGitStatusQuietly: expect.any(Function),
      refreshDiffQuietly: expect.any(Function)
    })
    expect(() => options.refreshDiffQuietly()).not.toThrow()
  })
```

- [ ] **Step 6: App の統合の失敗するテストを書く**

`src/renderer/src/components/__tests__/App.folderAutoRefresh.test.tsx`:

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FolderChangeEvent, GitStatusResult } from '@shared/types'
import type { FileTreeNode } from '../../types'

// gitApi をまるごとモックする。App.commit.test.tsx と同じ方針
vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(() => Promise.resolve([])),
  getHeadCommitMessage: vi.fn(() => Promise.resolve(null)),
  getBranches: vi.fn(() => Promise.resolve([])),
  getTags: vi.fn(() => Promise.resolve([])),
  amendCommit: vi.fn(),
  push: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)

const cleanStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

const initialTree: FileTreeNode[] = [
  {
    name: 'lib',
    path: '/project/lib',
    type: 'directory',
    children: [{ name: 'b.ts', path: '/project/lib/b.ts', type: 'file' }]
  },
  {
    name: 'src',
    path: '/project/src',
    type: 'directory',
    children: [{ name: 'a.ts', path: '/project/src/a.ts', type: 'file' }]
  }
]

let folderListener: ((event: FolderChangeEvent) => void) | null = null

function treeItemOf(name: string): HTMLElement {
  const item = within(screen.getByRole('tree')).getByText(name).closest('[role="treeitem"]')
  if (!(item instanceof HTMLElement)) throw new Error(`treeitem が無い: ${name}`)
  return item
}

async function openFolder(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  folderListener = null
  window.api.openFolder = vi.fn().mockResolvedValue('/project')
  window.api.readDirectory = vi.fn().mockResolvedValue(structuredClone(initialTree))
  window.api.setFolderWatch = vi.fn().mockResolvedValue(undefined)
  window.api.onFolderChange = vi.fn((listener: (event: FolderChangeEvent) => void) => {
    folderListener = listener
    return () => undefined
  })
  mockGetGitStatus.mockResolvedValue(cleanStatus)
})

describe('App: 開いているフォルダの外の変更の自動の反映', () => {
  it('マウント → 監視を頼む', async () => {
    await openFolder()
    expect(window.api.setFolderWatch).toHaveBeenCalledWith(true)
  })

  it('通知 → ツリーに新しいファイルが出て、閉じていたフォルダは閉じたまま、新しいフォルダは開いて出る', async () => {
    await openFolder()
    await userEvent.click(treeItemOf('lib'))
    expect(treeItemOf('lib')).toHaveAttribute('aria-expanded', 'false')
    window.api.readDirectory = vi.fn().mockResolvedValue([
      {
        name: 'auto-dir',
        path: '/project/auto-dir',
        type: 'directory',
        children: [{ name: 'inner.txt', path: '/project/auto-dir/inner.txt', type: 'file' }]
      },
      ...structuredClone(initialTree),
      { name: 'auto.txt', path: '/project/auto.txt', type: 'file' }
    ])
    act(() => {
      folderListener?.({ treeChanged: true })
    })
    await waitFor(() =>
      expect(within(screen.getByRole('tree')).getByText('auto.txt')).toBeInTheDocument()
    )
    expect(treeItemOf('lib')).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByRole('tree')).queryByText('b.ts')).not.toBeInTheDocument()
    expect(treeItemOf('auto-dir')).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('tree')).getByText('inner.txt')).toBeInTheDocument()
  })

  it('git だけの通知 → 取り直しの間もソース管理の 更新 は淡色にならず、読み込み中... も出ず、変更が一覧に出る', async () => {
    await openFolder()
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    await waitFor(() => expect(mockGetGitStatus).toHaveBeenCalled())
    const refreshButton = document.querySelector('.source-control-panel__refresh-btn')
    if (!(refreshButton instanceof HTMLButtonElement)) throw new Error('更新 のボタンが無い')
    await waitFor(() => expect(refreshButton).toBeEnabled())
    let resolveStatus: (status: GitStatusResult) => void = () => undefined
    mockGetGitStatus.mockReturnValueOnce(
      new Promise<GitStatusResult>((resolve) => {
        resolveStatus = resolve
      })
    )
    const callsBefore = mockGetGitStatus.mock.calls.length
    act(() => {
      folderListener?.({ treeChanged: false })
    })
    await waitFor(() => expect(mockGetGitStatus.mock.calls.length).toBe(callsBefore + 1))
    expect(refreshButton).toBeEnabled()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    await act(async () => {
      resolveStatus({ ...cleanStatus, files: [{ path: 'a.txt', index: ' ', workingDir: 'M' }] })
    })
    await waitFor(() => expect(screen.getByText('a.txt')).toBeInTheDocument())
    // ツリーは読み直さない(treeChanged: false)
    expect(window.api.readDirectory).toHaveBeenCalledOnce()
  })
})
```

（`screen.getByTitle(activityBarPanels[1].title)` は `App.commit.test.tsx` の `openGitPanel` と同じソース管理パネルの開き方。フォルダの行の押し方は `DirectoryItem.tsx` の `onClick` で開閉が切り替わる）

- [ ] **Step 7: 前提が変わる既存の App のテストを直す（`App.agentChanges.test.tsx`）**

`src/renderer/src/components/__tests__/App.*.test.tsx` のうち、ウィンドウの `focus`・`visibilitychange` を発火するのは `App.agentChanges.test.tsx` だけ（`grep -ln "Event('focus')\|visibilitychange" src/renderer/src/components/__tests__/App.*.test.tsx` で確かめる。ほかのファイルが出たら、同じ考え方で直す）。このファイルの `describe` の中の 3 件（`window.dispatchEvent(new Event('focus'))` の後に `getAgentChangeDiff` の回数をちょうどで数える）は、設計どおりの挙動で前提が変わる。`getGitStatus` は毎回同じ内容（`repoStatus`）を返すので、`useFolderAutoRefresh` の静かな git status の取得は受け入れられて true を返し、focus から約 50ms（`FOLDER_AUTO_REFRESH_WAIT_MS`）で `refreshDiffQuietly` が走り、開いている agent の diff タブの `getAgentChangeDiff` が 1 回増える。これは、エージェントの変更の一覧の取り直し（`AUTO_REFRESH_WAIT_MS` = 300ms の後）より先に来る。直し方は次の 3 つ:

- 自動の反映の 1 回を数に入れて、期待の回数を直す
- `mockReturnValueOnce` の差し込みは、自動の反映の 1 回が終わった後に置く（先に置くと、自動の反映の呼び出しがそれを使ってしまう）
- 「読み込み中... を出さない」「ハンクのフォーカスを保つ」の確かめは残し、自動の反映の後にも確かめる

1 件目（`一覧が同じなら、取り直しの間も戻すボタンを押せるままにし、…ハンクのフォーカスを保つ`）を次にする:

```tsx
    it('一覧が同じなら、取り直しの間も戻すボタンを押せるままにし、diff は静かに取り直して(内容が同じなら作り直さず)ハンクのフォーカスを保つ', async () => {
      const hunk = await openAgentDiffAndFocusHunk()
      const diffCalls = vi.mocked(window.api.getAgentChangeDiff).mock.calls.length
      const listCalls = vi.mocked(window.api.listAgentChanges).mock.calls.length
      const pending = deferredList()
      vi.mocked(window.api.listAgentChanges).mockReturnValueOnce(pending.promise)

      window.dispatchEvent(new Event('focus'))
      // 開いているフォルダの自動の反映(useFolderAutoRefresh。git status が同じでも受け入れたら diff を静かに取り直す。
      // 設計書 2026-11-08)が、一覧の取り直しより先に diff を 1 回取る。読み込み中にせず、フォーカスも保つ
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 1)
      )
      expect(screen.queryByText('読み込み中...')).toBeNull()
      expect(hunk).toHaveFocus()
      // 一覧の取り直しの後の diff だけを止める(自動の反映の 1 回の後に差し込む)
      const pendingDiff = deferredDiff()
      vi.mocked(window.api.getAgentChangeDiff).mockReturnValueOnce(pendingDiff.promise)

      await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledTimes(listCalls + 1))
      // 取り直しの間: セクションの ↶・すべて戻す・ハンクの戻すは押せるまま、フォーカスはハンクのまま
      expect(
        within(section()).getByRole('button', { name: 'a.txt を実行前の状態に戻す' })
      ).toBeEnabled()
      expect(within(section()).getByRole('button', { name: 'すべて戻す' })).toBeEnabled()
      expect(hunk).toBeEnabled()
      expect(hunk).toHaveFocus()

      // 一覧が届くと diff を静かに取り直す。取り直しの間も読み込み中に差し替えない
      await act(async () => {
        pending.resolve(listed)
      })
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 2)
      )
      expect(screen.queryByText('読み込み中...')).toBeNull()
      expect(hunk).toBeInTheDocument()
      expect(hunk).toHaveFocus()
      // 内容が同じなら作り直さない(同じ要素のままフォーカスを保つ)
      await act(async () => {
        pendingDiff.resolve(
          'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 2)
      expect(screen.queryByText('読み込み中...')).toBeNull()
      expect(hunk).toBeInTheDocument()
      expect(hunk).toHaveFocus()
    })
```

2 件目（`一覧が同じでも、同じファイルの続きの変更は、…`）を次にする（自動の反映の 1 回は既定の内容〈続きの変更なし〉を返し、その後の一覧の取り直しの diff で続きの変更を届ける。差し込みを先に置くと、自動の反映が続きの変更を取り、その後の一覧の取り直しの diff が既定の内容で上書きしうる）:

```tsx
    it('一覧が同じでも、同じファイルの続きの変更は、読み込み中を挟まずに開いている diff へ反映する', async () => {
      await openAgentDiffAndFocusHunk()
      const diffCalls = vi.mocked(window.api.getAgentChangeDiff).mock.calls.length

      window.dispatchEvent(new Event('focus'))
      // 開いているフォルダの自動の反映が先に diff を 1 回静かに取る(設計書 2026-11-08)
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 1)
      )
      expect(screen.queryByText('読み込み中...')).toBeNull()
      const pendingDiff = deferredDiff()
      vi.mocked(window.api.getAgentChangeDiff).mockReturnValueOnce(pendingDiff.promise)
      // 一覧の取り直しの完了で、開いている diff をもう 1 回静かに取る
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 2)
      )
      expect(screen.queryByText('読み込み中...')).toBeNull()
      await act(async () => {
        pendingDiff.resolve(
          'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-a\n+b\n+CONTINUED_CHANGE\n'
        )
      })
      expect(await screen.findByText(/CONTINUED_CHANGE/)).toBeInTheDocument()
      expect(screen.queryByText('読み込み中...')).toBeNull()
    })
```

3 件目（`一覧が変わったら、開いている agent の diff タブを取り直す`）の `await waitFor(() => expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 1))` を次にする（`diffCalls + 1` のままだと、自動の反映の 1 回だけで通ってしまい、一覧の変化での取り直しを確かめない。L-174）:

```tsx
      // 1 回目は開いているフォルダの自動の反映(設計書 2026-11-08)、2 回目が一覧の変化での取り直し
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 2)
      )
```

（`toHaveBeenLastCalledWith('a.txt', { kind: 'all' })` は今のまま）

直したら、3 件が今の実装（Task 11 の Step 5 の組み立ての後）で通ること、`useAppState.ts` の `useFolderAutoRefresh({ … })` を一時的に消すと 3 件とも落ちる（回数が 1 足りない）ことを確かめてから戻す

- [ ] **Step 8: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useFolderAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.folderAutoRefresh.test.tsx src/renderer/src/components/__tests__/App.agentChanges.test.tsx`
Expected: PASS。続けて App の既存の統合のテストが変わらず通ることを確かめる: `NODE_ENV=test npx vitest run src/renderer/src/components/__tests__`（`getGitStatus`・`getAgentChangeDiff` の呼び出しの回数を数えるテストがあるため。Step 7 のほかに落ちるものがあったら、自動の反映が設計どおりに走った分かを確かめ、そうなら Step 7 と同じ考え方で回数と差し込みの位置を直す。設計と違う挙動なら実装を直す。期待を緩めて通さない）

- [ ] **Step 9: 実装を戻すと落ちることを確かめる**

1. `refreshGitAndDiff` の `if (await …) options.current.refreshDiffQuietly()` を一時的に `await options.current.refreshGitStatusQuietly(); options.current.refreshDiffQuietly()` に変えて走らせ、`git status の取得が受け入れられなかった … → diff を呼ばない` が落ちることを確かめてから戻す
2. `useOnChange(options.folderPath, …)` の行を一時的に消して走らせ、`フォルダの切り替え → 前のフォルダの予約を捨てる` が落ちることを確かめてから戻す
3. `useAppState.ts` の `useFolderAutoRefresh({ … })` の呼び出しを一時的に消して走らせ、`App.folderAutoRefresh.test.tsx` の 3 件が落ちることを確かめてから戻す

- [ ] **Step 10: 検証**

Run: `npx eslint src/renderer/src/hooks/useFolderAutoRefresh.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useFolderAutoRefresh.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.folderAutoRefresh.test.tsx src/renderer/src/components/__tests__/App.agentChanges.test.tsx --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 12: 文書・実機テスト仕様書・全体の検証

設計書: 7 章（実機テスト仕様書の新しい項目・前提が変わる既存の項目・前提の文の書き直し）、8 章（ROADMAP・README・developer-guide）。知見: L-199（一致しなければ失敗する置換で書き換え、整形は変えたファイルだけ）、L-203（前提の変わる手動テスト・ROADMAP の既知の制約を同じ変更で直す）。実機（Electron）の確認の手順はここに書かない（仕様書の ID: EXP-117〜EXP-128、GIT-183〜GIT-190、直した EXP-072・EXP-080・EXP-081・EXP-090・EXP-099・AGC-058・BRN-005・BRN-047・BRN-067 を利用者がまとめて確かめる）。

**Files:**
- Modify: `docs/manual-test-spec.md`
- Modify: `ROADMAP.md`・`README.md`・`docs/developer-guide.md`
- 再生成: `.superpowers/manual-test-spec.html`（`node scripts/build-manual-test-spec.mjs` の出力）

**Interfaces:**
- Consumes: Task 1〜11 の実装（チャンネル名・ファイル名・定数）
- Produces: 文書の更新だけ

- [ ] **Step 1: 実機テスト仕様書に新しい項目を足す**

`docs/manual-test-spec.md`:
- 「エクスプローラー」の最後の項目 EXP-116 の行の後、`## エディタ` の前に、設計書 7 章の 1 つ目のコードブロックの中身（`### ファイルツリーの自動の反映`・前提・EXP-117〜EXP-128）を 1 字も変えずに写す
- 「ソース管理（基本）」の最後の項目 GIT-182 の行の後、`## ブランチ操作` の前に、設計書 7 章の 2 つ目のコードブロックの中身（`### 外部の変更の自動の反映`・前提・GIT-183〜GIT-190）を 1 字も変えずに写す
- 見出し・前提・項目の前後の空行は、仕様書の既存の節（例: `### 全体のエージェントの指示ファイル`）と同じにする

写す前に `grep -c '^- \[ \] \*\*\(EXP-11[7-9]\|EXP-12[0-8]\|GIT-18[3-9]\|GIT-190\)\*\*' docs/manual-test-spec.md` が 0、写した後に 20 であること（項目の行だけを数える。前提の行の `EXP-122・EXP-123` は数えない）（新しい ID は接頭辞ごとの最大値の次から。EXP は 116、GIT は 182 が今の最大）

- [ ] **Step 2: 前提が変わる既存の項目と前提の文を直す（ID は変えない）**

設計書 7 章「前提が変わる既存の項目」のコードブロックのとおり、EXP-072・EXP-080・EXP-081・EXP-090・EXP-099・AGC-058・BRN-005・BRN-047・BRN-067 の行を、それぞれ行ごと置き換える（`- [ ] **<ID>**` で始まる 1 行を、設計書の同じ ID の 1 行に置き換える。一致しなければ失敗する置換で行う）。続けて:
- 「ブランチ操作」の `### ステータスバーのブランチの切り替え` の 2 つ目の前提（`> 前提: 端末で切り替えたブランチや作ったブランチは、`更新` を押すと…` で始まる行）を、設計書 7 章の `> 前提: 端末で切り替えたブランチは、ステータスバーに自動で反映される(2 秒以内)。…` の 1 行に置き換える
- 「ソース管理（基本）」の冒頭の前提の中の 1 文 `外部での変更はターミナルで行い、パネルの先頭の行の `↻`(ツールチップ `更新`。以降は `更新` と書く)で反映する。` だけを、設計書 7 章の `外部での変更はターミナルで行う。開いているリポジトリの中の変更は自動で反映される(2 秒以内)。項目の手順にある `更新` は、パネルの先頭の行の `↻`(ツールチップ `更新`。以降は `更新` と書く)を押す。` に置き換える（前後の文は変えない）

直した後に、次の 4 つがすべて 0 件であること（L-203）:
- `grep -n "ファイルツリーは自動では更新されない" docs/manual-test-spec.md`
- `grep -n "ファイルツリーに自動では反映されない" docs/manual-test-spec.md`
- `grep -n "git status はフォーカスの復帰で取り直さない" docs/manual-test-spec.md`
- `grep -n "で反映する。その右の" docs/manual-test-spec.md`

- [ ] **Step 3: HTML を再生成し、書式を検査する**

Run: `node scripts/build-manual-test-spec.mjs && NODE_ENV=test npx vitest run scripts`
Expected: 生成が成功し、テストが PASS（ID の一意性・接頭辞ごとの連番の昇順・書式）

Artifact（<manual-test-spec-artifact-url>）は同じファイルパス `.superpowers/manual-test-spec.html` で再公開する。**実際の公開はこのプランを実行している親のセッションが行う**（サブエージェントは再生成までで止め、再公開が要ることを報告に書く）

- [ ] **Step 4: ROADMAP を直す**

`ROADMAP.md`（行番号は設計した時点のもの。文字列で探して直す）:
1. 「ファイル / ワークスペース管理」の `- [ ] ファイル変更の自動検知・ツリー自動更新（file watcher。開いているタブの外部変更の検知は MVP で実装済み。エクスプローラーのツリーとソース管理の自動更新・diff タブの取り直しは未実装）` を次にする:

```markdown
- [x] ファイル変更の自動検知・ツリー自動更新（file watcher）: ファイルツリー・ソース管理（git status）・アクティブな diff タブを、開いているフォルダの recursive の監視とウィンドウのフォーカスの復帰で静かに取り直す（2026-11-08。設計書 `docs/superpowers/specs/2026-11-08-file-tree-auto-refresh-design.md`）。開いているタブの外部変更の検知は MVP で実装済み
  - 既知の制約: Linux では監視を張らない（フォーカスの復帰でだけ反映する）
  - 既知の制約: `node_modules`・`.git`・`out`・`dist`・`.next` の中の変化は git status の取り直しも走らせない（フォーカスの復帰・`更新` まで）
  - 既知の制約: `.gitignore` に従った除外はしない（ツリーに出る範囲の無視されたファイルを頻繁に書くツールがあると、そのたびにツリーの全部の読み直しと git status が走る）
  - 既知の制約: 通知のたびにツリーの全部（6 段まで）を読み直す（部分的な読み直しはしない）
  - 既知の制約: git の作業ディレクトリが開いているフォルダの外（worktree・`GIT_DIR` の外出し・サブフォルダを開いた場合）にあると、外での `git add`・`git commit` などは監視で拾わない
  - 既知の制約: git status の取得は `GIT_OPTIONAL_LOCKS=0` で行う（アプリの `git status` は index の stat の情報を書き直さない。stat の古いファイルが多い大きなリポジトリでは、毎回の status が遅くなりうる）
  - 既知の制約: 全体の指示ファイル（`~/.claude/CLAUDE.md` など）は監視しない
```

2. 既知の制約の `- 監視は開いているタブの親ディレクトリだけで、エクスプローラーのツリーとソース管理は自動で更新しない。エージェントが作ったファイルはツリーに出ない（フォルダを開き直す）` を `- 監視は開いているタブの親ディレクトリだけで、エクスプローラーのツリーとソース管理は自動で更新しなかった。エージェントが作ったファイルはツリーに出なかった（2026-11-08 から、ツリーとソース管理は開いているフォルダの監視で自動で更新する）` にする（行頭の字下げは今のまま）
3. `- diff タブは、ファイルの git status の文字が変わらない限り、エージェントの変更で取り直さない（既存の挙動）` を `- diff タブは、ファイルの git status の文字が変わらない限り、エージェントの変更で取り直さなかった（2026-11-08 から、外の変更の後にアクティブな diff タブを静かに取り直す）` にする（行頭の字下げは今のまま）
4. `ソース管理の git status は今も取り直さない）` を `ソース管理の git status は 2026-11-08 から、ファイルツリー・ソース管理の自動更新で取り直す）` にする
5. `- 外部（ターミナルやエージェント CLI）で足した・消した指示ファイルは、ツリーを読み直すまで一覧に反映しない。節の `更新` を押す（自動の反映は file watcher）` を `- 外部（ターミナルやエージェント CLI）で足した・消した指示ファイルは、ツリーを読み直すまで一覧に反映しなかった（2026-11-08 から、開いているフォルダの監視でツリーと一緒に自動で反映する。全体の指示ファイルは監視しない）` にする
6. エージェントの指示ファイルの項目の `残り: プロンプトの内容の追記、外部での追加・削除の自動の反映（file watcher）` を `実装済み（2026-11-08）: フォルダの中の指示ファイルの外部での追加・削除の自動の反映（file watcher）。残り: プロンプトの内容の追記` にする
7. 全体の指示ファイルの既知の制約（`外部（ターミナルやエージェント CLI）で足した・消した全体の指示ファイルは、…`）と「隠しファイル / 除外パターン（.gitignore 準拠）の表示制御」は変えない

直した後に `grep -n "ツリーとソース管理の自動更新・diff タブの取り直しは未実装\|git status は今も取り直さない\|外部での追加・削除の自動の反映（file watcher）$" ROADMAP.md` が 0 件であること

- [ ] **Step 5: README と developer-guide を直す**

`README.md`:
- 「主な機能」の **エクスプローラー・エディタ** の文の最後（`全体の指示ファイル（`~/.claude/CLAUDE.md` など）も開く・作ることができます。` の後）に `外で作った・消したファイルや git の操作を、ファイルツリーとソース管理に自動で反映します（macOS・Windows）。` を足す
- 「main（`src/main/`）」の `fileAccessScope.ts`・`globalAgentInstructionAccess.ts` の行の後に足す:

```markdown
- `folderChangeWatcher.ts`・`folderChangeClassifier.ts`: 開いているフォルダの recursive の監視（所有者ごとに 1 本。張るかは renderer の `fs:setFolderWatch`、どのフォルダかは許可フォルダで決める）と、通知の相対パスを「ツリー」「git status だけ」「無視」に分ける純粋な関数。
```

- 「renderer（`src/renderer/src/`）」の `hooks/` の `useFileSystem.ts` の行の後と、`lib/` の `readFileAfterPendingSaves.ts` の行の後にそれぞれ足す:

```markdown
  - `useFolderAutoRefresh.ts`: 監視の通知（`fs:folderChange`）とウィンドウのフォーカスの復帰で、ファイルツリー・git status・アクティブな diff タブを静かに取り直す（読み込み中の表示を出さず、内容が同じなら置き換えない）。
```

```markdown
  - `refreshScheduler.ts`: 取り直しの合流（待ち・上限・実行中の「もう 1 回」・世代）。React に依らない。
```

`docs/developer-guide.md`:
- 「3.2 main → renderer の通知」の 1 段落目の `外部でのファイルの変更\n(`fs:externalChange`)などは、` の `(`fs:externalChange`)` を `(`fs:externalChange`)・開いているフォルダの変化の合図(`fs:folderChange`。監視を張るかは renderer の `fs:setFolderWatch`、どのフォルダかは main が決める)` にする
- 「6. よくある落とし穴」の最後の項目の後に足す:

```markdown
- **アプリが実行する `git status` は `.git/index` を書き換えうる。** `git status` は `.git/index.lock` を作って消し、作業ツリーの stat の情報が
  古いと `.git/index` も書き直す。`.git` の監視を契機に git status を取り直すと、自分の取得が次の通知を起こして止まらなくなりうるので、
  `gitService.ts` の `getGitStatus` は `GIT_OPTIONAL_LOCKS=0` で取る(設計書 2026-11-08 の 1 章の 8・9)。
```

整形は変えたファイルだけに `npx prettier --check <パス>` で確かめる（崩れていれば `--write`。L-199）

- [ ] **Step 6: 全体の検証**

Run（順に）:
- `NODE_ENV=test npm test`
- `npm run typecheck`
- `npx eslint . --max-warnings 0`
- `npm run build`
- `NODE_ENV=test npx vitest run scripts`

Expected: すべて成功。失敗したら、原因のタスクの手順に戻って直す（テストを消したり期待を緩めたりして通さない）。重い処理と並べると時間切れで落ちるテストがある（developer-guide 6 章）ので、落ちたら単独で流し直して再現するかを確かめる

- [ ] **Step 7: 変更の範囲を確かめる**

Run: `git status --short && git diff --stat`
Expected: 「ファイルの構成」の表のファイルと、各タスクで足した・直したテスト（`folderChangeClassifier.test.ts`・`folderChangeWatcher*.test.ts`・`folderChangeWatcherLifecycle.test.ts`・`handlers/folderChangeHandlers.test.ts`・`ipcHandlers.test.ts`・`agentBaselineDependencies.test.ts`・`gitService*.test.ts`・`api.test.ts`・`fileSystemApi.test.ts`・`refreshScheduler.test.ts`・`fileTreeEquality.test.ts`・`gitStatusEquality.test.ts`・`useFileTreeOperations.test.ts`・`useFileSystem.test.ts`・`useAgentInstructionFiles.quietReload.test.ts`・`useGitStatus.test.ts`・`useAgentChangesWiring.test.ts`・`useDiffOperations.test.ts`・`useAppState*.test.ts`・`useFolderAutoRefresh.test.ts`・`App.folderAutoRefresh.test.tsx`・`App.agentChanges.test.tsx`）、未追跡の設計書とこのプランだけが変わっている（`.superpowers/manual-test-spec.html` は git の管理外なので出ない）。無関係な差分（整形だけの変更など）があれば戻す（L-199）。コミットはしない

---

## 設計書の要件とタスクの対応

| 設計書 | 要件 | タスク |
| --- | --- | --- |
| 3 章「変化の分類」 | `tree`・`git`・`ignore` の規則、win32 の区切り、`.git` の一覧・`.lock`・`refs/prompt-ide`、`SKIP_DIRS`、`MAX_DEPTH + 1` | Task 1 |
| 3 章「監視」 | 所有者ごとに 1 本、`enable`・`disable`・`onFolderChanged`、待ち 300ms・上限 1000ms、閉じた監視の通知を捨てる、`error`・同期の throw で監視無し、`notify` の throw を握りつぶす、`persistent: false` | Task 2・Task 3 |
| 3 章「寿命」 | `folder-changed` で張り直し、`destroyed`・`crashed`・`reloaded` で無効 | Task 3 |
| 3 章「IPC」 | `fs:setFolderWatch`（boolean 以外は例外・同期）、`fs:folderChange`（パスを入れない）、`FolderChangeEvent` | Task 2（型）・Task 3・Task 5 |
| 3 章「組み立て」・2 章の 5 | `ipcHandlers.ts` の組み立て、Linux では張らない | Task 3 |
| 3 章「git status の取得」・1 章の 8・9 | `GIT_OPTIONAL_LOCKS=0`、`INHERITED_ENV_ALLOWANCES` を `gitInheritedEnv.ts` へ移す | Task 4 |
| 3 章「preload」 | `setFolderWatch`・`onFolderChange`（形の合わない payload を捨てる）、`fileSystemApi`、`setup.ts` の stub | Task 5 |
| 3 章「合流」 | `refreshScheduler`、`useAgentChangesAutoRefresh` の置き換えと 14 行目のコメント | Task 6 |
| 3 章「ツリーの静かな読み直し」 | `reloadTree({ quiet })`、手動を追い越さない (a)、最新のツリーとの比べ、静かな失敗を出さない、`refreshTreeQuietly`・`isFolderScanPending`、`isSameFileTree` | Task 7・Task 8 |
| 3 章「git status の静かな取り直し」 | `refreshGitStatusQuietly`・`wasGitStatusSetQuietly`、番号の共有、`inheritsLoud`、完了の時点の控えとの比べ、走査中を反映しない、`isSameGitStatus` | Task 7・Task 9 |
| 3 章「エージェントの変更の一覧の連鎖」 | 静かな status なら `refreshAgentChanges({ quiet: true })` | Task 10 |
| 3 章「diff タブ」 | 受け入れた後に `refreshDiff({ quiet: true })`、文字が変わっても静かに取る (a) | Task 10（固定のテスト）・Task 11 |
| 3 章「自動の取り直し」 | `useFolderAutoRefresh`（50ms・300ms、`{ tree }` の論理和、走査中・受け入れなかったときは diff を取らない、`allSettled`、`setFolderWatch` の登録と解除、購読と `reset`、フォルダの切り替えで `reset`、読み上げない）、`useAppState` の組み立て | Task 11 |
| 3 章「エラーの扱い」 | 監視・送信・ツリー・git status・diff の失敗の扱い | Task 2・Task 3・Task 8・Task 9・Task 10 |
| 4 章「テスト方針」 | 各テスト | 各タスクの Step（配線のテストは Task 11 の `App.folderAutoRefresh.test.tsx`） |
| 7 章 | 実機テスト仕様書の新しい項目・既存の項目と前提の文の直し、HTML の再生成 | Task 12 |
| 8 章 | ROADMAP・README・developer-guide | Task 12 |
