import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CreateTagRequest } from '@shared/types'
import { COMMITTER_UNKNOWN_MESSAGE, createTag } from '../gitTagService'
import {
  commitAll,
  initRepo,
  killRecordedProcess,
  runGit,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// 'é' の NFC(1 文字)と NFD(e + 結合文字)。見た目は同じだが別の文字列
const NFC_E = '\u00e9'
const NFD_E = 'e\u0301'

// reftable(git 2.45 以降)が使えるかを実行時に判定する。使えない git では該当のテストを明示的にスキップする
function supportsReftable(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'reftable-probe-'))
  try {
    runGit(probe, 'init', '-q', '--ref-format=reftable')
    return true
  } catch {
    return false
  } finally {
    removeTempPathSync(probe)
  }
}

// gitTagService.test.ts は simple-git をモックするため、実際の git が引数をどう解釈するか
// (-- と HEAD の位置、--message の 1 引数、--no-sign、--cleanup)は検証できない。ここで実 git で固定する
describe('gitTagService(実 git)', () => {
  let repo: string

  const rev = (ref: string): string => runGit(repo, 'rev-parse', ref).trim()
  const objectType = (ref: string): string => runGit(repo, 'cat-file', '-t', ref).trim()
  const tagNames = (): string[] =>
    runGit(repo, 'tag', '-l')
      .split('\n')
      .filter((line) => line !== '')
  // %(contents) は本文の後に改行を付け、for-each-ref も行末に改行を足すため、末尾の改行を除いて比べる
  const tagMessage = (name: string): string =>
    runGit(repo, 'for-each-ref', '--format=%(contents)', `refs/tags/${name}`).replace(/\n+$/, '')
  const commit = (path: string, content: string, message = 'c'): void => {
    writeRepoFile(repo, path, content)
    commitAll(repo, message)
  }
  const lightweight = (name: string): CreateTagRequest => ({
    name,
    kind: 'lightweight',
    message: ''
  })
  const annotated = (name: string, message: string): CreateTagRequest => ({
    name,
    kind: 'annotated',
    message
  })

  beforeEach(() => {
    stubIsolatedGitEnv()
    repo = mkdtempSync(join(tmpdir(), 'tag-integration-'))
    initRepo(repo)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(repo)
  })

  it('軽量タグを現在の HEAD に作る(オブジェクトの種類は commit)', async () => {
    commit('a.txt', 'one')
    await createTag(repo, lightweight('v1.0.0'))
    expect(objectType('v1.0.0')).toBe('commit')
    expect(rev('v1.0.0')).toBe(rev('HEAD'))
  })

  it('注釈付きタグを現在の HEAD に作る(オブジェクトの種類は tag)', async () => {
    commit('a.txt', 'one')
    await createTag(repo, annotated('v1.0.0', 'リリース 1.0.0'))
    expect(objectType('v1.0.0')).toBe('tag')
    expect(rev('v1.0.0^{commit}')).toBe(rev('HEAD'))
    expect(tagMessage('v1.0.0')).toBe('リリース 1.0.0')
  })

  // -m <値> だと simple-git が拒否し、`-` 始まりは git のオプションになりうる(パターン 21・49)
  it.each(['-x', '--upload-pack=evil', '-c core.pager=evil'])(
    '- で始まるメッセージ %j もそのまま本文になる',
    async (message) => {
      commit('a.txt', 'one')
      await createTag(repo, annotated('v1', message))
      expect(tagMessage('v1')).toBe(message)
    }
  )

  // 既定の cleanup(strip)は # で始まる行を消す(実機で確認)。--cleanup=whitespace で残す
  it('日本語・空白・複数行・# で始まる行を含むメッセージをそのまま残す', async () => {
    commit('a.txt', 'one')
    const message = '#1 リリース 準備\n\n本文 の 2 行目'
    await createTag(repo, annotated('v1', message))
    expect(tagMessage('v1')).toBe(message)
  })

  it('同じ名前のタグがあれば拒否し、既存のタグは変わらない', async () => {
    commit('a.txt', 'one')
    runGit(repo, 'tag', 'v1')
    const before = rev('v1')
    commit('a.txt', 'two')
    await expect(createTag(repo, lightweight('v1'))).rejects.toMatchObject({
      message: '同じ名前のタグが既に存在します: v1'
    })
    expect(rev('v1')).toBe(before)
  })

  it.each([
    ['v1/x', 'v1', 'v1'],
    ['v1', 'v1/x', 'v1/x']
  ])('%s は既存のタグ %s と階層が衝突するので拒否する', async (name, existing, conflicting) => {
    commit('a.txt', 'one')
    runGit(repo, 'tag', existing)
    await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
      message: `既存のタグ ${conflicting} と名前が衝突します: ${name}`
    })
    expect(tagNames()).toEqual([existing])
  })

  // 大文字小文字を区別しない FS(macOS)では、packed-refs の 'v1' があると git は 'V1' を終了コード 0 で
  // 作り、`git rev-parse v1` が 'V1' のコミットを返す。loose なら英語のエラーになる(実機 git 2.50.1 で確認)
  describe.each([
    ['packed-refs', true],
    ['loose', false]
  ])('大文字小文字だけが違う既存のタグ(%s)', (_label, pack) => {
    it.each([
      ['V1', 'v1'],
      ['V1/x', 'v1']
    ])(
      '%s は既存のタグ %s と衝突するので拒否し、既存のタグの解決を変えない',
      async (name, existing) => {
        commit('a.txt', 'one')
        runGit(repo, 'tag', existing)
        if (pack) runGit(repo, 'pack-refs', '--all')
        const before = rev(existing)
        commit('a.txt', 'two')
        await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
          message: `既存のタグ ${existing} と名前が衝突します: ${name}`
        })
        expect(rev(existing)).toBe(before)
        expect(tagNames()).toEqual([existing])
      }
    )
  })

  // git は同名のタグを黙って作る(終了コード 0)。アプリの側から曖昧さを作らない(パターン 43)
  it.each(['feat', 'FEAT'])('ブランチ feat があるとき %s のタグは作らない', async (name) => {
    commit('a.txt', 'one')
    runGit(repo, 'branch', 'feat')
    await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
      message: `同じ名前のブランチが存在するため、タグを作成できません: ${name}`
    })
    expect(tagNames()).toEqual([])
  })

  // APFS(大文字小文字を区別しない)は完全な case folding で名前を比べるため、packed-refs の 'ss' があると
  // git は 'ß' を終了コード 0 で作り、`git rev-parse refs/tags/ss` が 'ß' のコミットを返す。ブランチ 'ss' が
  // あると `git rev-parse ss` が曖昧になる(いずれも実機 git 2.50.1 / APFS で確認)。判定は文字列の比較なので
  // FS に依存せず、APFS でない環境でも同じく拒否する
  describe('完全な case folding(ß と ss など)', () => {
    it('packed-refs のタグ ss があるとき、ß は日本語の衝突のエラーで拒否し、ss の解決を変えない', async () => {
      commit('a.txt', 'one')
      runGit(repo, 'tag', 'ss')
      runGit(repo, 'pack-refs', '--all')
      const before = rev('refs/tags/ss')
      commit('a.txt', 'two')
      await expect(createTag(repo, lightweight('ß'))).rejects.toMatchObject({
        message: '既存のタグ ss と名前が衝突します: ß'
      })
      expect(rev('refs/tags/ss')).toBe(before)
      expect(tagNames()).toEqual(['ss'])
    })

    it('ブランチ ss があるとき、ß のタグは作らない', async () => {
      commit('a.txt', 'one')
      runGit(repo, 'branch', 'ss')
      await expect(createTag(repo, lightweight('ß'))).rejects.toMatchObject({
        message: '同じ名前のブランチが存在するため、タグを作成できません: ß'
      })
      expect(tagNames()).toEqual([])
    })
  })

  // check-ref-format --normalize は NFD をそのまま返す。入口で NFC にそろえないと、次が起きる
  // (いずれも実機 git 2.50.1 / macOS で確認)
  describe('Unicode の正規化(NFC / NFD)', () => {
    // 正規化しないと、NFD のタグが終了コード 0 で作られ、`git rev-parse <NFC>` が新しいコミットを返す
    it('core.precomposeunicode=false で packed-refs の NFC のタグがあるとき、NFD の要求は重複として拒否し、既存のタグの解決を変えない', async () => {
      runGit(repo, 'config', 'core.precomposeunicode', 'false')
      commit('a.txt', 'one')
      runGit(repo, 'tag', NFC_E)
      runGit(repo, 'pack-refs', '--all')
      const before = rev(NFC_E)
      commit('a.txt', 'two')
      await expect(createTag(repo, lightweight(NFD_E))).rejects.toMatchObject({
        message: `同じ名前のタグが既に存在します: ${NFC_E}`
      })
      expect(rev(NFC_E)).toBe(before)
      expect(tagNames()).toEqual([NFC_E])
    })

    // 正規化しないと、git が argv を NFC に直すため英語の `fatal: tag 'é' already exists` が漏れる
    it('既定の設定で NFC のタグがあるとき、NFD の要求は日本語の重複のエラーで拒否する', async () => {
      commit('a.txt', 'one')
      runGit(repo, 'tag', NFC_E)
      const before = rev(NFC_E)
      commit('a.txt', 'two')
      await expect(createTag(repo, lightweight(NFD_E))).rejects.toMatchObject({
        message: `同じ名前のタグが既に存在します: ${NFC_E}`
      })
      expect(rev(NFC_E)).toBe(before)
    })

    // 正規化しないと、git tag は NFC 名で作って終了コード 0 になるが、作成後の確認(NFD の ref)が
    // 見つからず「タグを作成できませんでした」を投げる(タグは NFC 名で残る)
    it.skipIf(!supportsReftable())(
      'reftable のリポジトリでも NFD の要求を NFC のタグとして作成する',
      async () => {
        removeTempPathSync(repo)
        mkdirSync(repo)
        runGit(repo, 'init', '-q', '-b', 'main', '--ref-format=reftable')
        runGit(repo, 'config', 'user.email', 'test@example.com')
        runGit(repo, 'config', 'user.name', 'test')
        runGit(repo, 'config', 'commit.gpgsign', 'false')
        commit('a.txt', 'one')
        await createTag(repo, lightweight(NFD_E))
        expect(tagNames()).toEqual([NFC_E])
        expect(rev(`refs/tags/${NFC_E}`)).toBe(rev('HEAD'))
      }
    )

    it('NFD の要求は NFC の名前の注釈付きタグとして作成する', async () => {
      commit('a.txt', 'one')
      await createTag(repo, annotated(`v1-${NFD_E}`, 'm'))
      expect(tagNames()).toEqual([`v1-${NFC_E}`])
      expect(objectType(`refs/tags/v1-${NFC_E}`)).toBe('tag')
    })
  })

  it.each(['HEAD', 'head', '@', 'a..b', 'a b', 'x.lock', '/x', 'a//b', 'x/'])(
    '使えない名前 %j は拒否し、タグを作らない',
    async (name) => {
      commit('a.txt', 'one')
      await expect(createTag(repo, lightweight(name))).rejects.toMatchObject({
        message: `タグ名として使用できない名前です: ${name}`
      })
      expect(tagNames()).toEqual([])
    }
  )

  it('detached HEAD でも、今の HEAD に作る', async () => {
    commit('a.txt', 'one')
    commit('a.txt', 'two')
    runGit(repo, 'checkout', '-q', '--detach', 'HEAD~1')
    await createTag(repo, lightweight('old'))
    expect(rev('old')).toBe(rev('HEAD'))
    expect(rev('old')).not.toBe(rev('main'))
  })

  it('マージ中でも作成でき、マージ中の状態は変わらない', async () => {
    commit('f.txt', 'base\n')
    runGit(repo, 'checkout', '-q', '-b', 'topic')
    commit('f.txt', 'topic\n')
    runGit(repo, 'checkout', '-q', 'main')
    commit('f.txt', 'main\n')
    // コンフリクトすると git merge は終了コード 1 で終わる(runGit は例外を投げる)
    expect(() => runGit(repo, 'merge', 'topic')).toThrow()
    const mergeHead = rev('MERGE_HEAD')
    await createTag(repo, lightweight('during-merge'))
    expect(rev('during-merge')).toBe(rev('HEAD'))
    expect(rev('MERGE_HEAD')).toBe(mergeHead)
    expect(runGit(repo, 'ls-files', '-u')).not.toBe('')
  })

  it('コミットが無いリポジトリでは拒否する', async () => {
    await expect(createTag(repo, lightweight('v1'))).rejects.toMatchObject({
      message: 'コミットが無いため、タグを作成できません'
    })
  })

  describe('コミッター情報が無い環境', () => {
    // 開発者の環境変数がコミッター情報を補わないよう外し、自動推定も無効にする(パターン 46)
    beforeEach(() => {
      commit('a.txt', 'one')
      runGit(repo, 'config', '--unset', 'user.name')
      runGit(repo, 'config', '--unset', 'user.email')
      runGit(repo, 'config', 'user.useConfigOnly', 'true')
      ;[
        'GIT_COMMITTER_NAME',
        'GIT_COMMITTER_EMAIL',
        'GIT_AUTHOR_NAME',
        'GIT_AUTHOR_EMAIL',
        'EMAIL'
      ].forEach((key) => vi.stubEnv(key, undefined))
    })

    it('注釈付きタグは日本語で拒否し、作らない', async () => {
      await expect(createTag(repo, annotated('v1', 'm'))).rejects.toMatchObject({
        message: COMMITTER_UNKNOWN_MESSAGE
      })
      expect(tagNames()).toEqual([])
    })

    it('軽量タグは作れる', async () => {
      await createTag(repo, lightweight('v1'))
      expect(objectType('v1')).toBe('commit')
    })
  })

  describe('tag.gpgSign=true で署名に失敗する環境(パターン 45)', () => {
    // --no-sign を外す変異で git がエディタを起動して待たないよう、エディタはすぐ失敗させる
    beforeEach(() => {
      commit('a.txt', 'one')
      runGit(repo, 'config', 'tag.gpgSign', 'true')
      runGit(repo, 'config', 'gpg.program', 'false')
      vi.stubEnv('GIT_EDITOR', 'false')
    })

    it('軽量タグは署名の設定に関わらず軽量のまま作る', async () => {
      await createTag(repo, lightweight('v1'))
      expect(objectType('v1')).toBe('commit')
    })

    it('注釈付きタグは署名の設定に従い、失敗を git のメッセージ付きで伝える', async () => {
      await expect(createTag(repo, annotated('v1', 'm'))).rejects.toThrow(
        /^タグを作成できませんでした: .+/
      )
      expect(tagNames()).toEqual([])
    })
  })

  // -a(--annotate)を明示すると tag.forceSignAnnotated より優先され、署名なしのタグが黙って作られる
  // (実機 git 2.50.1 で確認)。署名の方針は上書きしない(パターン 45)
  describe('tag.forceSignAnnotated=true で署名に失敗する環境(パターン 45)', () => {
    beforeEach(() => {
      commit('a.txt', 'one')
      runGit(repo, 'config', 'tag.forceSignAnnotated', 'true')
      runGit(repo, 'config', 'gpg.program', 'false')
      vi.stubEnv('GIT_EDITOR', 'false')
    })

    it('注釈付きタグは署名を試み、失敗を git のメッセージ付きで伝え、タグを残さない', async () => {
      await expect(createTag(repo, annotated('v1', 'm'))).rejects.toThrow(
        /^タグを作成できませんでした: .+/
      )
      expect(tagNames()).toEqual([])
    })

    it('軽量タグは影響を受けず作れる', async () => {
      await createTag(repo, lightweight('v1'))
      expect(objectType('v1')).toBe('commit')
    })
  })

  // 署名のパスフレーズの入力待ち(pinentry・ssh-keygen)では git tag がいつまでも終わらない(実機 git 2.50.1 で
  // 確認)。入力を待ち続ける署名プログラムで再現し、短いタイムアウトを注入して打ち切られることを固定する。
  // 署名プログラムは sh のスクリプトのため Windows では実行しない
  describe.skipIf(process.platform === 'win32')('署名が入力を待ち続ける環境', () => {
    const SHORT_TIMEOUT_MS = 1500
    let scriptDir: string
    let pidFile: string

    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }

    beforeEach(() => {
      commit('a.txt', 'one')
      scriptDir = mkdtempSync(join(tmpdir(), 'tag-hanging-gpg-'))
      pidFile = join(scriptDir, 'pids')
      const script = join(scriptDir, 'hanging-gpg.sh')
      // 自分の pid と親(git)の pid を書き、入力を待つ代わりに眠り続ける
      writeFileSync(script, `#!/bin/sh\necho "$$ $PPID" > '${pidFile}'\nexec sleep 300\n`)
      chmodSync(script, 0o755)
      runGit(repo, 'config', 'tag.forceSignAnnotated', 'true')
      runGit(repo, 'config', 'gpg.program', script)
      vi.stubEnv('GIT_EDITOR', 'false')
    })

    afterEach(async () => {
      // git が打ち切られた後も署名プログラムは孤児として残る(既知の制約)。テストの後始末として止める
      await killRecordedProcess(pidFile)
      removeTempPathSync(scriptDir)
    })

    it('注釈付きタグは時間内に終わらなければ日本語で失敗し、git を止め、タグもロックも残さない', async () => {
      await expect(createTag(repo, annotated('v1', 'm'), SHORT_TIMEOUT_MS)).rejects.toThrow(
        'タグの作成が時間内に終わりませんでした（署名のパスフレーズの入力待ちなど）: v1'
      )
      const [, gitPid] = readFileSync(pidFile, 'utf8').trim().split(' ').map(Number)
      expect(isAlive(gitPid)).toBe(false)
      expect(tagNames()).toEqual([])
      expect(existsSync(join(repo, '.git', 'refs', 'tags', 'v1.lock'))).toBe(false)
    })

    it('タイムアウトの後、署名の設定を直せば同じ名前で作れる(ref のロックが残らない)', async () => {
      await expect(createTag(repo, annotated('v1', 'm'), SHORT_TIMEOUT_MS)).rejects.toThrow(
        /時間内に終わりませんでした/
      )
      runGit(repo, 'config', 'tag.forceSignAnnotated', 'false')
      await createTag(repo, annotated('v1', 'm'), SHORT_TIMEOUT_MS)
      expect(objectType('v1')).toBe('tag')
    })

    it('軽量タグは署名しないため影響を受けず作れる', async () => {
      await createTag(repo, lightweight('v1'), SHORT_TIMEOUT_MS)
      expect(objectType('v1')).toBe('commit')
    })
  })
})
