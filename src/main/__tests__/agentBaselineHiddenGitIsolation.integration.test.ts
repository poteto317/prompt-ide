import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  createBaselineGit,
  runBaselineGitWithInput,
  runBaselineGitWithInputSync,
  runIsolatedGit
} from '../agentBaselineGit'
import type { BaselineGitLocation } from '../agentBaselineGit'
import { createHiddenGit } from '../agentBaselineHiddenGit'
import { parseWriteTreeOutput, takeBaselineSnapshot } from '../agentBaselineSnapshot'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { getAgentChangeDiff } from '../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { AgentRevertContext } from '../agentChangesRevert'
import { executeAgentChangesUndo } from '../agentChangesUndo'
import { isCaseInsensitiveFs, runGit, writeRepoFile } from './helpers/realGitRepo'
import {
  FAKE_INSTANCE_ID,
  createAgentNonGitFolder,
  createFakeTrash,
  disposeAgentBaselineRepo,
  firstHunkPatch,
  makeRevertContext,
  numberedLines,
  snapshotBase
} from './helpers/agentBaselineFixtures'

// 隠れた git の記録の一連の操作(作成・createBaselineGit・runBaselineGitWithInput(Sync)・記録・一覧・diff・戻す・取り消し)が、
// 利用者の大域の設定(core.hooksPath・core.fsmonitor・init.defaultObjectFormat・init.defaultRefFormat)と親の環境の
// GIT_CONFIG_PARAMETERS の影響を受けないことを実 git で試す(設計書「セキュリティ」・未確認事項 1・3)。隠れた git の作成そのものの
// 中身は agentBaselineHiddenGit.integration.test.ts。利用者の大域の設定は、隔離した HOME の .gitconfig に書いて試す
// (記録の git は GIT_CONFIG_GLOBAL を外して HOME の設定を読む。テストの runGit は GIT_CONFIG_GLOBAL=/dev/null のため --global は効かない)

describe('隠れた git の記録と利用者の大域の設定・親の環境(実 git)', () => {
  let home: string
  let tempDir: string
  let folder: string

  // Git 管理外のフォルダと隔離した HOME。tempDir は記録の一時ディレクトリ(createHiddenGit に直接渡す)と、記録の tempRoot を兼ねる
  beforeEach(() => {
    ;({ repo: folder, home, tempRoot: tempDir } = createAgentNonGitFolder('hidden-git-isolation-'))
    writeRepoFile(folder, 'a.txt', 'one\ntwo\n')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo: folder, home, tempRoot: tempDir }))

  const writeGlobalConfig = (body: string): void => writeFileSync(join(home, '.gitconfig'), body)
  const locationOf = (gitDir: string): BaselineGitLocation => ({
    folderPath: folder,
    indexPath: join(tempDir, 'index'),
    gitDir
  })
  // 記録(始点。base を渡すと区切り)を取る。recorded でなければ例外
  const take = async (
    base?: BaselineSnapshot,
    env?: NodeJS.ProcessEnv
  ): Promise<BaselineSnapshot> => {
    const result = await takeBaselineSnapshot(folder, {
      tempRoot: tempDir,
      instanceId: FAKE_INSTANCE_ID,
      base: base === undefined ? undefined : snapshotBase(base),
      env
    })
    if (result.kind !== 'recorded') throw new Error(JSON.stringify(result))
    return result.snapshot
  }
  const revertContext = (snapshot: BaselineSnapshot, env?: NodeJS.ProcessEnv): AgentRevertContext =>
    makeRevertContext(snapshot, {
      trash: createFakeTrash().trash,
      tempRoot: tempDir,
      gitOptions: { env }
    })

  describe('利用者の大域の core.hooksPath の hook(セキュリティ)', () => {
    let marker: string

    beforeEach(() => {
      const hooks = join(home, 'hooks')
      mkdirSync(hooks)
      marker = join(home, 'hook-ran')
      for (const name of [
        'post-index-change',
        'pre-commit',
        'post-checkout',
        'reference-transaction'
      ]) {
        writeFileSync(join(hooks, name), `#!/bin/sh\necho ${name} >> "${marker}"\n`, {
          mode: 0o755
        })
      }
      writeGlobalConfig(`[core]\n\thooksPath = ${hooks}\n`)
    })

    // 記録・一覧・戻すが使う、index を書きうる命令
    const runSteps = async (location: BaselineGitLocation): Promise<void> => {
      const git = createBaselineGit(location)
      await git.raw(['add', '-A'])
      writeRepoFile(folder, 'a.txt', 'one\nchanged\n')
      await git.raw(['diff'])
      await git.raw(['restore', '--worktree', '--', 'a.txt'])
    }

    it('隠れた git の作成(init・config)でも大域の hook(init の reference-transaction)が動かない', async () => {
      await createHiddenGit(tempDir)
      expect(existsSync(marker)).toBe(false)
    })

    // createBaselineGit は隠れた git に -c core.hooksPath を常に付ける(hiddenGitCommandConfig)ため、前提は -c を付けない runIsolatedGit で確かめる
    it('前提: 隠れた git の設定も -c も無い bare リポジトリでは、記録の命令で大域の hook(post-index-change)が動く', async () => {
      const bare = join(tempDir, 'plain.git')
      runGit(tempDir, 'init', '-q', '--bare', '--template=', bare)
      await runIsolatedGit(folder, ['add', '-A'], {
        extraEnv: { GIT_DIR: bare, GIT_WORK_TREE: folder, GIT_INDEX_FILE: join(tempDir, 'index') }
      })
      expect(existsSync(marker)).toBe(true)
    })

    it('隠れた git では、add・diff・restore の後に hook が動かない(隠れた git の設定と命令の -c で core.hooksPath を gitDir の中の存在しないパスにする)', async () => {
      await runSteps(locationOf(await createHiddenGit(tempDir)))
      expect(existsSync(marker)).toBe(false)
      expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    })

    // 親の環境の GIT_CONFIG_PARAMETERS(git -c の受け渡し。simple-git も buildIsolatedGitEnv も除かない)は隠れた git の config より
    // 後に読まれるため、隠れた git の config だけでは利用者の hook・fsmonitor の命令が動く。隠れた git の命令には -c で
    // core.hooksPath・core.fsmonitor=false を常に付け、親の値より後に読ませる(テストの env は env の選択肢で渡し、process.env を汚さない)
    describe('親の環境の GIT_CONFIG_PARAMETERS で core.hooksPath・core.fsmonitor を利用者のものに向けたとき', () => {
      let fsmonitorMarker: string
      let parentEnv: NodeJS.ProcessEnv

      beforeEach(() => {
        fsmonitorMarker = join(home, 'fsmonitor-ran')
        const fsmonitor = join(home, 'fsmonitor.sh')
        writeFileSync(fsmonitor, `#!/bin/sh\necho fsmonitor >> "${fsmonitorMarker}"\nexit 1\n`, {
          mode: 0o755
        })
        // 大域の設定の hook は使わず、親の環境からだけ向ける
        writeGlobalConfig('')
        parentEnv = {
          ...process.env,
          GIT_CONFIG_PARAMETERS: `'core.hookspath'='${join(home, 'hooks')}' 'core.fsmonitor'='${fsmonitor}'`
        }
      })

      it('前提: 隠れた git の config があっても、-c を付けない命令では親の環境の hook と fsmonitor が動く', async () => {
        const gitDir = await createHiddenGit(tempDir, { env: parentEnv })
        await runIsolatedGit(folder, ['add', '-A'], {
          env: parentEnv,
          extraEnv: {
            GIT_DIR: gitDir,
            GIT_WORK_TREE: folder,
            GIT_INDEX_FILE: join(tempDir, 'index')
          }
        })
        expect(existsSync(marker)).toBe(true)
        expect(existsSync(fsmonitorMarker)).toBe(true)
      })

      it('隠れた git の作成・createBaselineGit・runBaselineGitWithInput(Sync) では hook も fsmonitor も動かない', async () => {
        const location = locationOf(await createHiddenGit(tempDir, { env: parentEnv }))
        const git = createBaselineGit(location, { env: parentEnv })
        await git.raw(['add', '-A'])
        writeRepoFile(folder, 'a.txt', 'one\nchanged\n')
        await git.raw(['diff'])
        await git.raw(['restore', '--worktree', '--', 'a.txt'])
        await runBaselineGitWithInput(
          location,
          ['update-index', '-z', '--force-remove', '--stdin'],
          'a.txt\0',
          { env: parentEnv }
        )
        expect(
          runBaselineGitWithInputSync(
            location,
            ['update-index', '-z', '--add', '--stdin'],
            'a.txt\0',
            {
              env: parentEnv
            }
          )
        ).toBe(true)
        expect(existsSync(marker)).toBe(false)
        expect(existsSync(fsmonitorMarker)).toBe(false)
        expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
      })
    })
    it('記録(始点・区切り)・一覧・diff・戻す(ファイル・ハンク・すべて戻す)の一連の操作の後に hook が動かない', async () => {
      writeRepoFile(folder, 'd.txt', numberedLines(20))
      writeRepoFile(folder, 'b.txt', 'b\n')
      const baseline = await take()
      writeRepoFile(folder, 'a.txt', 'one\ntwo\nagent\n')
      const checkpoint = await take(baseline)
      writeRepoFile(folder, 'd.txt', numberedLines(20, { 2: 'A2', 18: 'A18' }))
      writeRepoFile(folder, 'b.txt', 'b\nagent\n')
      writeRepoFile(folder, 'c.txt', 'c\n')
      await listAgentChanges(baseline)
      await listAgentChangesBetween(baseline, checkpoint)
      const context = revertContext(baseline)
      const diff = await getAgentChangeDiff(baseline, 'd.txt')
      await revertAgentChangeHunk(context, 'd.txt', firstHunkPatch(diff))
      await revertAgentChange(context, 'a.txt')
      await revertAllAgentChanges(context, [
        { path: 'b.txt', status: 'M' },
        { path: 'c.txt', status: 'A' },
        { path: 'd.txt', status: 'M' }
      ])
      expect(readFileSync(join(folder, 'd.txt'), 'utf8')).toBe(numberedLines(20))
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(join(folder, '.git'))).toBe(false)
    }, 30_000)
  })

  // 隠れた git は利用者のリポジトリではないため、改行コードを変換せずバイトのまま記録・復元する(隠れた git の設定の
  // core.autocrlf=false・core.safecrlf=false)。大域の設定だけで変換されると、戻した後の改行コードが記録の時点と変わる
  // (Git for Windows の既定はシステムの設定に core.autocrlf=true)。safecrlf=true では変換が要る LF のファイルで記録が失敗する
  describe('利用者の大域の core.autocrlf・core.safecrlf(改行コードを変換しない)', () => {
    const LF = 'a\nb\n'
    const CRLF = 'a\r\nb\r\n'
    const bytesOf = (p: string): Buffer => readFileSync(join(folder, p))

    // LF と CRLF のファイルを記録 → エージェント役が変える → 行の ↶(revertAgentChange)と すべて戻す の後のバイトが記録の時点と同じ
    const recordChangeRevert = async (): Promise<void> => {
      writeRepoFile(folder, 'lf.txt', LF)
      writeRepoFile(folder, 'crlf.txt', CRLF)
      writeRepoFile(folder, 'lf2.txt', LF)
      writeRepoFile(folder, 'crlf2.txt', CRLF)
      const baseline = await take()
      for (const [p, content] of [
        ['lf.txt', LF],
        ['crlf.txt', CRLF],
        ['lf2.txt', LF],
        ['crlf2.txt', CRLF]
      ] as const) {
        writeRepoFile(folder, p, `${content}agent\n`)
      }
      const context = revertContext(baseline)
      await revertAgentChange(context, 'lf.txt')
      await revertAgentChange(context, 'crlf.txt')
      await revertAllAgentChanges(context, [
        { path: 'crlf2.txt', status: 'M' },
        { path: 'lf2.txt', status: 'M' }
      ])
      expect(bytesOf('lf.txt')).toEqual(Buffer.from(LF))
      expect(bytesOf('crlf.txt')).toEqual(Buffer.from(CRLF))
      expect(bytesOf('lf2.txt')).toEqual(Buffer.from(LF))
      expect(bytesOf('crlf2.txt')).toEqual(Buffer.from(CRLF))
      expect((await listAgentChanges(baseline)).entries).toEqual([])
    }

    it('大域の core.autocrlf=true でも、LF・CRLF のファイルを戻した後のバイトが記録の時点と同じ', async () => {
      writeGlobalConfig('[core]\n\tautocrlf = true\n')
      await recordChangeRevert()
    }, 30_000)

    it('大域の core.autocrlf=input でも、LF・CRLF のファイルを戻した後のバイトが記録の時点と同じ', async () => {
      writeGlobalConfig('[core]\n\tautocrlf = input\n')
      await recordChangeRevert()
    }, 30_000)

    it('大域の core.autocrlf=true・core.safecrlf=true でも記録でき、戻した後のバイトが記録の時点と同じ', async () => {
      writeGlobalConfig('[core]\n\tautocrlf = true\n\tsafecrlf = true\n')
      await recordChangeRevert()
    }, 30_000)

    // ハンクで戻す(revertAgentChangeHunk の git apply)も隠れた git の設定で動かす(ローカルレビュー第 6 周の指摘 1)。フォルダを cwd に
    // して隠れた git を指さずに動かすと、git はリポジトリの外として大域の core.autocrlf=true を読み、LF のファイル全体を CRLF で書き戻す
    it.each([
      { label: 'core.autocrlf=true', body: 'autocrlf = true' },
      {
        label: 'core.autocrlf=true・core.safecrlf=true',
        body: 'autocrlf = true\n\tsafecrlf = true'
      }
    ])(
      '大域の $label でも、LF・CRLF のファイルをハンクで戻した後のバイトが記録の時点(戻さないハンクを除く)と同じ',
      async ({ body }) => {
        writeGlobalConfig(`[core]\n\t${body}\n`)
        // アプリの環境と同じく GIT_CONFIG_GLOBAL を持たない(テストの隔離の GIT_CONFIG_GLOBAL=/dev/null が残ると、隠れた git の外で動く
        // git も大域の設定を読まず、この食い違いを試せない。HOME は隔離済み)
        vi.stubEnv('GIT_CONFIG_GLOBAL', undefined)
        const crlf = (text: string): string => text.replace(/\n/g, '\r\n')
        writeRepoFile(folder, 'lf.txt', numberedLines(20))
        writeRepoFile(folder, 'crlf.txt', crlf(numberedLines(20)))
        const baseline = await take()
        writeRepoFile(folder, 'lf.txt', numberedLines(20, { 2: 'A2', 18: 'A18' }))
        writeRepoFile(folder, 'crlf.txt', crlf(numberedLines(20, { 2: 'A2', 18: 'A18' })))
        const context = revertContext(baseline)
        for (const p of ['lf.txt', 'crlf.txt']) {
          await revertAgentChangeHunk(
            context,
            p,
            firstHunkPatch(await getAgentChangeDiff(baseline, p))
          )
        }
        expect(bytesOf('lf.txt')).toEqual(Buffer.from(numberedLines(20, { 18: 'A18' })))
        expect(bytesOf('crlf.txt')).toEqual(Buffer.from(crlf(numberedLines(20, { 18: 'A18' }))))
      },
      30_000
    )
  })

  // 変更の検出(一覧の diff --name-status)の stat の比較を、利用者の大域の設定で緩めない(ローカルレビュー第 6 周の指摘 2・4。
  // 隠れた git の設定の core.ignoreStat=false・core.checkStat=default・core.trustctime=true・diff.autoRefreshIndex=true)
  describe('利用者の大域の変更の検出の設定(ignoreStat・checkStat・trustctime・diff.autoRefreshIndex)', () => {
    // 記録より十分前の時刻(racy git の内容の確かめ直しが起きないよう、記録の index より古い mtime にする)
    const OLD = new Date(Date.now() - 3600_000)
    const listOf = async (snapshot: BaselineSnapshot): Promise<string[]> =>
      (await listAgentChanges(snapshot)).entries.map((e) => `${e.status} ${e.path}`)

    it('大域の core.ignoreStat=true でも、記録の後の変更・削除が一覧に出る', async () => {
      writeGlobalConfig('[core]\n\tignoreStat = true\n')
      writeRepoFile(folder, 'b.txt', 'b\n')
      const baseline = await take()
      writeRepoFile(folder, 'a.txt', 'one\nagent\n')
      rmSync(join(folder, 'b.txt'))
      expect(await listOf(baseline)).toEqual(['M a.txt', 'D b.txt'])
    })

    it('大域の core.checkStat=minimal・core.trustctime=false でも、大きさと mtime を保って中身を変えたファイルが一覧に出る', async () => {
      writeGlobalConfig('[core]\n\tcheckStat = minimal\n\ttrustctime = false\n')
      writeRepoFile(folder, 'c.txt', 'abc\n')
      utimesSync(join(folder, 'c.txt'), OLD, OLD)
      const baseline = await take()
      // 既定の設定で見分ける手がかりは ctime(git は秒で比べる)。記録と同じ秒に書き換えると既定の設定でも見分けられないため待つ
      await new Promise((resolve) => setTimeout(resolve, 1100))
      writeRepoFile(folder, 'c.txt', 'xyz\n')
      utimesSync(join(folder, 'c.txt'), OLD, OLD)
      expect(await listOf(baseline)).toEqual(['M c.txt'])
    }, 30_000)

    it('大域の diff.autoRefreshIndex=false でも、mtime だけが変わったファイルは一覧に出ない', async () => {
      writeGlobalConfig('[diff]\n\tautoRefreshIndex = false\n')
      utimesSync(join(folder, 'a.txt'), OLD, OLD)
      const baseline = await take()
      utimesSync(join(folder, 'a.txt'), new Date(), new Date())
      expect(await listOf(baseline)).toEqual([])
    })
  })

  // init が既定と同じ値なら書かないファイルシステムの性質の鍵を、利用者の大域の値で変えない(ローカルレビュー第 6 周の指摘 3)
  describe('利用者の大域のファイルシステムの性質の設定(core.symlinks・core.ignorecase)', () => {
    it('大域の core.symlinks=false でも、消されたシンボリックリンクを戻すとリンクに戻る', async () => {
      writeGlobalConfig('[core]\n\tsymlinks = false\n')
      symlinkSync('a.txt', join(folder, 'link'))
      const baseline = await take()
      rmSync(join(folder, 'link'))
      await revertAgentChange(revertContext(baseline), 'link')
      expect(lstatSync(join(folder, 'link')).isSymbolicLink()).toBe(true)
      expect(readlinkSync(join(folder, 'link'))).toBe('a.txt')
    })

    // 大文字小文字を区別しないボリューム(macOS の既定)では init が core.ignorecase=true を書くため試せない(作成の命令の並びの単体テストで固定)
    it('大域の core.ignorecase=true でも、大文字小文字だけが違う 2 つのファイルを記録できる(大文字小文字を区別するボリューム)', async (ctx) => {
      if (isCaseInsensitiveFs()) ctx.skip()
      writeGlobalConfig('[core]\n\tignorecase = true\n')
      writeRepoFile(folder, 'README.md', 'upper\n')
      writeRepoFile(folder, 'readme.md', 'lower\n')
      const baseline = await take()
      writeRepoFile(folder, 'readme.md', 'lower\nagent\n')
      expect((await listAgentChanges(baseline)).entries.map((e) => e.path)).toEqual(['readme.md'])
    })
  })

  it('利用者の大域の core.fsmonitor=true があっても、隠れた git の記録で fsmonitor の daemon を起動しない(未確認事項 1)', async () => {
    writeGlobalConfig('[core]\n\tfsmonitor = true\n')
    const gitDir = await createHiddenGit(tempDir)
    const git = createBaselineGit(locationOf(gitDir))
    await git.raw(['add', '-A'])
    await git.raw(['ls-files', '-z', '--others', '--exclude-standard'])
    const daemonEnv = { extraEnv: { GIT_DIR: gitDir, GIT_WORK_TREE: folder } }
    try {
      // 起動していなければ status は「watching していない」旨か失敗を返す(daemon を持たない git でも失敗する)
      const status = await runIsolatedGit(folder, ['fsmonitor--daemon', 'status'], daemonEnv).then(
        (output) => output,
        (error: Error) => error.message
      )
      expect(status).not.toMatch(/is watching/)
    } finally {
      await runIsolatedGit(folder, ['fsmonitor--daemon', 'stop'], daemonEnv).catch(() => undefined)
    }
  })

  it('大域の init.defaultObjectFormat=sha256 を引き継いでも、記録の tree を 64 桁の ID で作れる(未確認事項 3 の一部。一連の操作は次の試験)', async () => {
    writeGlobalConfig('[init]\n\tdefaultObjectFormat = sha256\n')
    const git = createBaselineGit(locationOf(await createHiddenGit(tempDir)))
    await git.raw(['add', '-A'])
    expect(parseWriteTreeOutput(await git.raw(['write-tree']))).toMatch(/^[0-9a-f]{64}$/)
  })
  // 未確認事項 3 の残り。テストの隔離(stubIsolatedGitEnv)の GIT_DEFAULT_REF_FORMAT=files は設定より優先されるため、この試験だけ
  // それを除いた env を選択肢で渡す(process.env は変えず、ほかのテストに影響させない)
  it('大域の init.defaultObjectFormat=sha256・init.defaultRefFormat=reftable を引き継いでも、記録・一覧・diff・tree どうしの比較・戻す・すべて戻すが動く(未確認事項 3)', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.GIT_DEFAULT_REF_FORMAT
    const gitOptions = { env }
    writeGlobalConfig('[init]\n\tdefaultObjectFormat = sha256\n\tdefaultRefFormat = reftable\n')
    writeRepoFile(folder, 'b.txt', 'b\n')
    const baseline = await take(undefined, env)
    expect(baseline.tree).toMatch(/^[0-9a-f]{64}$/)
    // 隠れた git が本当に reftable で作られた(この試験が reftable を通っている)
    expect(existsSync(join(baseline.gitDir ?? '', 'reftable'))).toBe(true)
    writeRepoFile(folder, 'a.txt', 'one\ntwo\nrun1\n')
    const checkpoint = await take(baseline, env)
    expect(checkpoint.gitDir).toBe(baseline.gitDir)
    writeRepoFile(folder, 'b.txt', 'b\nrun2\n')
    writeRepoFile(folder, 'c.txt', 'c\n')
    expect(
      (await listAgentChangesBetween(baseline, checkpoint, gitOptions)).entries.map((e) => e.path)
    ).toEqual(['a.txt'])
    expect((await listAgentChanges(checkpoint, gitOptions)).entries.map((e) => e.path)).toEqual([
      'b.txt',
      'c.txt'
    ])
    const list = await listAgentChanges(baseline, gitOptions)
    expect(list.entries.map((e) => e.path)).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(list.headChanged).toBe(false)
    expect(await getAgentChangeDiff(baseline, 'b.txt', gitOptions)).toContain('+run2')
    const context = revertContext(baseline, env)
    await revertAgentChange(context, 'a.txt')
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    const all = await revertAllAgentChanges(context, [
      { path: 'b.txt', status: 'M' },
      { path: 'c.txt', status: 'A' }
    ])
    expect(readFileSync(join(folder, 'b.txt'), 'utf8')).toBe('b\n')
    expect((await listAgentChanges(baseline, gitOptions)).entries).toEqual([])
    // 取り消す(控えから戻す。git は使わないが、一連の操作として隠れた git の一覧に戻ることまで確かめる)
    if (all.capture.kind !== 'saved') throw new Error(JSON.stringify(all.capture))
    expect(
      await executeAgentChangesUndo({
        folderPath: folder,
        undo: { undoId: 1, operation: 'all', dir: all.capture.dir, items: all.capture.items },
        trash: context.trash
      })
    ).toMatchObject({ kind: 'done' })
    expect(readFileSync(join(folder, 'b.txt'), 'utf8')).toBe('b\nrun2\n')
    expect(readFileSync(join(folder, 'c.txt'), 'utf8')).toBe('c\n')
    expect((await listAgentChanges(baseline, gitOptions)).entries.map((e) => e.path)).toEqual([
      'b.txt',
      'c.txt'
    ])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  }, 30_000)
})
