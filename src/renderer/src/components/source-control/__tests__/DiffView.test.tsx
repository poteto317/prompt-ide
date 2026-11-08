import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DiffView from '../DiffView'
import { parseDiff, buildHunkPatch } from '../../../lib/diffParser'
import { makeAgentDiffActions } from '../../../__tests__/makeAgentChangesState'

const SAMPLE_DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  'index abc123..def456 100644',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,2 +1,2 @@',
  ' line1',
  '-line2',
  '+line2modified',
  '@@ -10,1 +10,2 @@',
  ' line10',
  '+line11new',
  ''
].join('\n')

describe('DiffView', () => {
  it('各ハンクを表示し、変更行を +/- で表示する', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('-line2')).toBeInTheDocument()
    expect(screen.getByText('+line2modified')).toBeInTheDocument()
    expect(screen.getByText('+line11new')).toBeInTheDocument()
  })

  it('staged=false のとき各ハンクにステージボタンを表示する', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(2)
  })

  it('staged=true のとき各ハンクにアンステージボタンを表示する', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={true}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをアンステージ' })).toHaveLength(2)
  })

  it('ステージボタンをクリックすると onStageHunk がそのハンクのパッチで呼ばれる', async () => {
    const onStageHunk = vi.fn()
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={onStageHunk}
        onUnstageHunk={vi.fn()}
      />
    )
    const buttons = screen.getAllByRole('button', { name: 'このハンクをステージ' })
    await userEvent.click(buttons[0])
    expect(onStageHunk).toHaveBeenCalledTimes(1)
    const patch = onStageHunk.mock.calls[0][0] as string
    expect(patch).toContain('@@ -1,2 +1,2 @@')
    expect(patch).not.toContain('@@ -10,1 +10,2 @@')
  })

  it('アンステージボタンをクリックすると onUnstageHunk がそのハンクのパッチで呼ばれる', async () => {
    const onUnstageHunk = vi.fn()
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={true}
        onStageHunk={vi.fn()}
        onUnstageHunk={onUnstageHunk}
      />
    )
    const buttons = screen.getAllByRole('button', { name: 'このハンクをアンステージ' })
    await userEvent.click(buttons[1])
    const patch = onUnstageHunk.mock.calls[0][0] as string
    expect(patch).toContain('@@ -10,1 +10,2 @@')
  })

  it('diffText が空文字列の場合、ハンクもボタンも表示しない', () => {
    render(<DiffView diffText="" staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).not.toBeInTheDocument()
  })

  it('diffText が空文字列の場合、差分が無いことを説明するメッセージを表示する', () => {
    // 未追跡ファイルの全ハンクをステージし終えると getDiff は空文字列を返すが、
    // 何も表示しないと空白の diff タブが残るだけでユーザーに状況が伝わらない
    render(<DiffView diffText="" staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />)
    expect(screen.getByText('差分はありません')).toBeInTheDocument()
  })

  it('ハンク(@@行)を含まない diffText(バイナリファイル等)は、ヘッダテキストを表示しステージボタンは出さない', () => {
    // ハンクが無いのに何も表示しないと、バイナリファイルを開いたときに空白の
    // ままで理由がユーザーに伝わらない。ボタンを出さないことで、破損した
    // 内容が誤ってステージされることも防げる
    render(
      <DiffView
        diffText={'Binary files /dev/null and b/image.png differ\n'}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('Binary files /dev/null and b/image.png differ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).not.toBeInTheDocument()
  })

  it('追跡済みバイナリファイルの diff は、git の配管出力(diff --git / index 行)を表示しない', () => {
    // 未追跡ファイルは main 側(buildBinaryDiffMessage)が 1 行のメッセージに
    // 置き換えているが、追跡済みファイルは git diff の出力がそのまま渡る。
    // ハンク(@@)が無いので全行が headerLines になり、
    // "diff --git a/f.bin b/f.bin" や "index 742c16a..19bbd83 100644" という
    // 内部表現がユーザーに露出してしまう
    render(
      <DiffView
        diffText={
          'diff --git a/f.bin b/f.bin\n' +
          'index 742c16a..19bbd83 100644\n' +
          'Binary files a/f.bin and b/f.bin differ\n'
        }
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('Binary files a/f.bin and b/f.bin differ')).toBeInTheDocument()
    expect(screen.queryByText(/^diff --git/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^index /)).not.toBeInTheDocument()
  })

  it('バイナリファイルのマージコンフリクトで、combined diff の内部表現(diff --cc)を表示しない', () => {
    // マージコンフリクト中のバイナリファイルは git diff が
    //   diff --cc f.bin
    //   index 8b73207,4ca423b..0000000
    //   Binary files differ
    // を返す(実機確認済み)。ハンクを持たないため isCombined によるボタン抑止
    // だけでは足りず、headerLines としてそのまま "diff --cc f.bin" が
    // 画面に露出してしまう
    render(
      <DiffView
        diffText={'diff --cc f.bin\nindex 8b73207,4ca423b..0000000\nBinary files differ\n'}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('Binary files differ')).toBeInTheDocument()
    expect(screen.queryByText(/^diff --cc/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^index /)).not.toBeInTheDocument()
  })

  it('内容変更を伴わないリネームのみの diff は、「差分はありません」ではなく rename from/to を表示する', () => {
    // ファイル名だけを変更してステージした場合、git diff はハンク(@@)を持たず
    //   diff --git a/old.txt b/new.txt
    //   similarity index 100%
    //   rename from old.txt
    //   rename to new.txt
    // の4行だけを返す(実機確認済み)。rename from/to も配管出力として除外すると
    // 「差分はありません」と表示され、実際にはリネームという変更があるのに
    // ユーザーには何も変わっていないように見えてしまう
    render(
      <DiffView
        diffText={
          'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'
        }
        staged={true}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('rename from old.txt')).toBeInTheDocument()
    expect(screen.getByText('rename to new.txt')).toBeInTheDocument()
    expect(screen.queryByText('差分はありません')).not.toBeInTheDocument()
  })

  it('実行権限(mode)のみの変更は、内容の差分が無くても mode 行を表示する', () => {
    // chmod +x だけを行った追跡済みファイルの git diff は
    //   diff --git a/s.sh b/s.sh
    //   old mode 100644
    //   new mode 100755
    // の 3 行だけでハンク(@@)を持たない(実機確認済み)。mode 行まで配管出力として
    // 除外すると「差分はありません」と表示され、Changes 一覧には " M" で出ている
    // のに diff タブでは何が変わったのか分からない状態になる
    render(
      <DiffView
        diffText={'diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100755\n'}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('old mode 100644')).toBeInTheDocument()
    expect(screen.getByText('new mode 100755')).toBeInTheDocument()
    expect(screen.queryByText('差分はありません')).not.toBeInTheDocument()
    expect(screen.queryByText(/^diff --git/)).not.toBeInTheDocument()
  })

  it('実行権限(mode)の変更と内容の変更を同時に行った場合、mode 行とハンクの両方を表示する', () => {
    // chmod +x と内容編集を同時に行った追跡済みファイルの git diff は
    //   diff --git a/s.sh b/s.sh
    //   old mode 100644
    //   new mode 100755
    //   index ...
    //   --- a/s.sh
    //   +++ b/s.sh
    //   @@ ... @@
    // のように mode 行と通常の @@ ハンクの両方を持つ(実機確認済み)。
    // mode 行(headerLines)の描画条件が「ハンクが無いとき」に限定されていると、
    // ハンクが存在するこのケースでは mode 変更の情報が一切見えなくなる
    render(
      <DiffView
        diffText={
          'diff --git a/s.sh b/s.sh\n' +
          'old mode 100644\n' +
          'new mode 100755\n' +
          'index abc123..def456 100755\n' +
          '--- a/s.sh\n' +
          '+++ b/s.sh\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-echo old\n' +
          '+echo new\n'
        }
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getByText('old mode 100644')).toBeInTheDocument()
    expect(screen.getByText('new mode 100755')).toBeInTheDocument()
    expect(screen.getByText('-echo old')).toBeInTheDocument()
    expect(screen.getByText('+echo new')).toBeInTheDocument()
  })

  it('コンフリクト中の combined diff では、必ず失敗するハンク操作ボタンを出さない', () => {
    // 未解決コンフリクト(UU)のファイルの diff は combined diff で、
    // git apply --cached は必ず "No valid patches in input" で失敗する
    // (実機で再現確認済み)。押せてしまうとユーザーは毎回エラーを見ることになる
    render(
      <DiffView
        diffText={
          'diff --cc f.txt\n' +
          'index db3c03a,797be14..0000000\n' +
          '--- a/f.txt\n' +
          '+++ b/f.txt\n' +
          '@@@ -1,3 -1,3 +1,7 @@@\n' +
          '  a\n' +
          '++<<<<<<< HEAD\n' +
          ' +Z\n'
        }
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).not.toBeInTheDocument()
    // なぜ操作できないのかが分かるよう理由を示す
    expect(screen.getByText(/コンフリクト/)).toBeInTheDocument()
  })

  it('combined diff の2文字プレフィックス行を、通常diffの1文字判定ではなく正しく追加/削除として色分けする', () => {
    // combined diff(親が2つ以上のマージコンフリクト)は、ハンクヘッダの "@" の
    // 数(親の数+1個)と同じ文字数のプレフィックスを各行に持つ。diff --cc(2親)
    // なら "@@@" の3つの "@" から親の数(2)がプレフィックス長になる。
    // line.startsWith('+')/('-') という1文字判定のままだと、2文字目に +/- が
    // 来る行(片方の親に対してのみ追加/削除された行)が「変更なし」の
    // コンテキスト行として灰色表示されてしまう
    const { container } = render(
      <DiffView
        diffText={
          'diff --cc f.txt\n' +
          'index db3c03a,797be14..0000000\n' +
          '--- a/f.txt\n' +
          '+++ b/f.txt\n' +
          '@@@ -1,3 -1,3 +1,7 @@@\n' +
          '  context\n' +
          '++both-added\n' +
          ' +one-side-added\n' +
          '--both-removed\n' +
          ' -one-side-removed\n'
        }
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    const added = container.querySelectorAll('.diff-view__line--added')
    const removed = container.querySelectorAll('.diff-view__line--removed')
    const context = container.querySelectorAll('.diff-view__line--context')
    expect(Array.from(added).map((el) => el.textContent)).toEqual([
      '++both-added',
      ' +one-side-added'
    ])
    expect(Array.from(removed).map((el) => el.textContent)).toEqual([
      '--both-removed',
      ' -one-side-removed'
    ])
    expect(Array.from(context).map((el) => el.textContent)).toEqual(['  context'])
  })

  it('表示が一部でも打ち切られたハンクには、操作ボタンを出さない(見えていない行までステージされるのを防ぐ)', () => {
    // 「表示行数が 0」だけを条件にすると、1 ハンクが 2500 行あり上限
    // (2000 行)分だけ表示されている場合、表示行数は 2000(> 0)なので
    // ボタンが有効なままになってしまう。ボタンは打ち切り前の全量(2500行)から
    // パッチを作るため、押すとユーザーが一度も見ていない残り 500 行まで
    // 丸ごとステージ/アンステージされる。「一部でも切り詰められているか」
    // (表示行数 < 実際の行数)で判定する必要がある
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <DiffView
        diffText={'diff --git a/big.txt b/big.txt\n' + hunk(1, 2500) + hunk(3000, 10)}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    // 1 つ目は 2500 行中 2000 行しか表示されていない(一部打ち切り)ので操作不可。
    // 2 つ目は 1 行も見えていない(全部打ち切り)ので同じく操作不可
    expect(screen.queryAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(0)
  })

  it('未追跡ファイル(isUntracked)は、表示が打ち切られていてもステージボタンを出す(git add はファイル全体を追加するため無関係)', () => {
    // useDiffOperations.ts の stageHunk は isActiveFileUntracked なら patch の
    // 内容を使わず gitApi.stageFile(path) でファイル全体を git add するだけ。
    // 「表示されていない行までパッチに含まれてしまう」という打ち切りの懸念が
    // そもそも当てはまらないため、巨大な新規ファイルでもボタンを隠してはいけない
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <DiffView
        diffText={'diff --git a/big.txt b/big.txt\n' + hunk(1, 2500)}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        isUntracked
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(1)
  })

  it('表示が打ち切られていないハンクには、通常どおり操作ボタンを出す', () => {
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <DiffView
        diffText={'diff --git a/small.txt b/small.txt\n' + hunk(1, 3)}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(1)
  })

  it('disabled=true のとき、ハンク操作ボタンが無効化される（多重実行防止）', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        disabled
      />
    )
    for (const button of screen.getAllByRole('button', { name: 'このハンクをステージ' })) {
      expect(button).toBeDisabled()
    }
  })

  it('disabled を渡さない場合、ハンク操作ボタンは有効', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
      />
    )
    for (const button of screen.getAllByRole('button', { name: 'このハンクをステージ' })) {
      expect(button).toBeEnabled()
    }
  })

  it('行数が上限を超える巨大な diff は、全行を描画せず表示を打ち切る', () => {
    // main 側のサイズ上限(MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES = 5MB)は
    // メインプロセスのメモリ/CPU スパイクを防ぐためのもので、レンダラー側には
    // 上限が無かった。.gitignore 設定前の生成物(整形済み JSON 等)を開くと
    // 数万個の DOM ノードが一度に生成され、ウィンドウが数秒ハングする
    const hugeLines = Array.from({ length: 30000 }, (_, i) => `+line${i}`).join('\n')
    const hugeDiff =
      'diff --git a/big.json b/big.json\n' +
      'new file mode 100644\n' +
      '--- /dev/null\n' +
      '+++ b/big.json\n' +
      '@@ -0,0 +1,30000 @@\n' +
      hugeLines +
      '\n'
    const { container } = render(
      <DiffView diffText={hugeDiff} staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(container.querySelectorAll('.diff-view__line').length).toBeLessThan(30000)
    expect(screen.getByText(/表示できません|省略/)).toBeInTheDocument()
  })
})

describe('DiffView — ハンクの取り消し', () => {
  const DISCARD = 'このハンクを取り消す'
  const SAME_HEADER_DIFF = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,1 +1,1 @@',
    '-x',
    '+y',
    '@@ -1,1 +1,1 @@',
    '-x',
    '+y',
    ''
  ].join('\n')

  it('canDiscardHunk が真・未ステージ・onDiscardHunk ありなら、各ハンクに取り消しボタンを出す', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={vi.fn()}
        canDiscardHunk
      />
    )
    expect(screen.getAllByRole('button', { name: DISCARD })).toHaveLength(2)
  })

  it('押したハンクのパッチと見出しだけが onDiscardHunk に渡る', async () => {
    const onDiscardHunk = vi.fn()
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={onDiscardHunk}
        canDiscardHunk
      />
    )
    const parsed = parseDiff(SAMPLE_DIFF)
    await userEvent.click(screen.getAllByRole('button', { name: DISCARD })[1])
    expect(onDiscardHunk).toHaveBeenCalledTimes(1)
    expect(onDiscardHunk).toHaveBeenCalledWith(buildHunkPatch(parsed, 1), parsed.hunks[1].header)
    expect(onDiscardHunk.mock.calls[0][0]).not.toBe(buildHunkPatch(parsed, 0))
  })

  it.each([
    ['canDiscardHunk が偽', { canDiscardHunk: false }],
    ['staged が真', { staged: true, canDiscardHunk: true }],
    ['未追跡ファイル(canDiscardHunk が偽)', { isUntracked: true, canDiscardHunk: false }],
    ['onDiscardHunk が無い', { onDiscardHunk: undefined, canDiscardHunk: true }]
  ])('%s のときは取り消しボタンを出さない', (_label, override) => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={vi.fn()}
        {...override}
      />
    )
    expect(screen.queryByRole('button', { name: DISCARD })).not.toBeInTheDocument()
  })

  it('結合 diff では取り消しボタンを出さない', () => {
    const combined = [
      'diff --cc f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@@ -1,1 -1,1 +1,5 @@@',
      '++<<<<<<< HEAD',
      ''
    ].join('\n')
    render(
      <DiffView
        diffText={combined}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={vi.fn()}
        canDiscardHunk
      />
    )
    expect(screen.queryByRole('button', { name: DISCARD })).not.toBeInTheDocument()
  })

  it('打ち切りで一部が表示されていないハンクには出さず、全て表示されているハンクには出す', () => {
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <DiffView
        diffText={'diff --git a/big.txt b/big.txt\n' + hunk(1, 10) + hunk(100, 2500)}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={vi.fn()}
        canDiscardHunk
      />
    )
    expect(screen.getAllByRole('button', { name: DISCARD })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(1)
  })

  it('disabled のときは押せない', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={vi.fn()}
        canDiscardHunk
        disabled
      />
    )
    for (const button of screen.getAllByRole('button', { name: DISCARD })) {
      expect(button).toBeDisabled()
    }
  })

  it('同じ見出しのハンクが複数あっても key が重複しない', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <DiffView
          diffText={SAME_HEADER_DIFF}
          staged={false}
          onStageHunk={vi.fn()}
          onUnstageHunk={vi.fn()}
          onDiscardHunk={vi.fn()}
          canDiscardHunk
        />
      )
      expect(screen.getAllByRole('button', { name: DISCARD })).toHaveLength(2)
      const keyWarnings = errorSpy.mock.calls.filter((call) => String(call[0]).includes('same key'))
      expect(keyWarnings).toHaveLength(0)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('DiffView — エージェントの変更', () => {
  it('ステージ・アンステージ・取り消しを出さず、「このハンクを実行前に戻す」だけを出す', async () => {
    const agentActions = makeAgentDiffActions()
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        onDiscardHunk={vi.fn()}
        canDiscardHunk
        agentActions={agentActions}
      />
    )
    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'このハンクを取り消す' })).toBeNull()
    const buttons = screen.getAllByRole('button', { name: 'このハンクを実行前に戻す' })
    expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[1])
    const parsed = parseDiff(SAMPLE_DIFF)
    expect(agentActions.onRevertHunk).toHaveBeenCalledWith(
      buildHunkPatch(parsed, 1),
      '@@ -10,1 +10,2 @@'
    )
  })

  // ボタンは打ち切り前の全量からパッチを作るため、見えていない行まで戻してしまわないよう、
  // 一部でも打ち切ったハンクには出さない(ステージ・取り消しと同じ規則)
  it('打ち切りで一部が表示されていないハンクには出さず、全て表示されているハンクには出す', () => {
    const hunk = (n: number, count: number): string =>
      `@@ -${n},0 +${n},${count} @@\n` +
      Array.from({ length: count }, (_, i) => `+h${n}line${i}`).join('\n') +
      '\n'
    render(
      <DiffView
        diffText={'diff --git a/big.txt b/big.txt\n' + hunk(1, 10) + hunk(100, 2500)}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        agentActions={makeAgentDiffActions()}
      />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクを実行前に戻す' })).toHaveLength(1)
  })

  it('戻せない diff(追加・削除)ではハンクのボタンを出さない', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        agentActions={makeAgentDiffActions({ canRevertHunk: false })}
      />
    )
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('直前の戻す操作の失敗を出す(読み上げは EditorPanel の常設の要素とセクションが行うため、alert にしない)', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        agentActions={makeAgentDiffActions({ error: 'ハンクを戻せませんでした' })}
      />
    )
    expect(screen.getByText('ハンクを戻せませんでした')).toHaveClass('diff-view__error')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('押せないときは理由を 1 か所に出し、ボタンから参照する(パターン 126)', () => {
    render(
      <DiffView
        diffText={SAMPLE_DIFF}
        staged={false}
        onStageHunk={vi.fn()}
        onUnstageHunk={vi.fn()}
        agentActions={makeAgentDiffActions({ disabledReason: '他の Git 操作の実行中です' })}
      />
    )
    for (const button of screen.getAllByRole('button', { name: 'このハンクを実行前に戻す' })) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription('他の Git 操作の実行中です')
    }
  })
})

describe('DiffView — 静かな取り直しでのフォーカス保持', () => {
  const makeDiff = (shift: number): string =>
    [
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc123..def456 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      `@@ -1,2 +1,${2 + shift} @@`,
      ' line1',
      ...Array.from({ length: shift }, (_, i) => `+added${i}`),
      '-line2',
      '+line2modified',
      `@@ -10,1 +${10 + shift},2 @@`,
      ' line10',
      '+line11new',
      ''
    ].join('\n')

  it('先頭に行が足されて新しい側の行番号だけずれても、2 つ目のハンクのボタンのフォーカスが残る', () => {
    const props = { staged: false, onStageHunk: vi.fn(), onUnstageHunk: vi.fn() }
    const { rerender } = render(<DiffView diffText={makeDiff(0)} {...props} />)
    const button = screen.getAllByRole('button', { name: 'このハンクをステージ' })[1]
    button.focus()
    expect(document.activeElement).toBe(button)

    rerender(<DiffView diffText={makeDiff(1)} {...props} />)

    const after = screen.getAllByRole('button', { name: 'このハンクをステージ' })[1]
    expect(after).toBe(button)
    expect(button.isConnected).toBe(true)
    expect(document.activeElement).toBe(button)
  })

  it('未追跡ファイルの行数が変わっても、ハンクのボタンのフォーカスが残る', () => {
    const makeUntracked = (n: number): string =>
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.txt',
        `@@ -0,0 +1,${n} @@`,
        ...Array.from({ length: n }, (_, i) => `+l${i}`),
        ''
      ].join('\n')
    const props = { staged: false, isUntracked: true, onStageHunk: vi.fn(), onUnstageHunk: vi.fn() }
    const { rerender } = render(<DiffView diffText={makeUntracked(2)} {...props} />)
    const button = screen.getByRole('button', { name: 'このハンクをステージ' })
    button.focus()

    rerender(<DiffView diffText={makeUntracked(3)} {...props} />)

    expect(button.isConnected).toBe(true)
    expect(document.activeElement).toBe(button)
  })

  it('旧の側の開始行が同じハンクが並んでも key が重複しない', () => {
    const dup = [
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -5,0 +6 @@',
      '+x',
      '@@ -5,0 +8 @@',
      '+y',
      ''
    ].join('\n')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<DiffView diffText={dup} staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
