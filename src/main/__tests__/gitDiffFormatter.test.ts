import { describe, it, expect } from 'vitest'
import {
  buildUntrackedDiff,
  isBinaryContent,
  buildBinaryDiffMessage,
  buildSymlinkDiffMessage,
  buildTooLargeDiffMessage,
  buildEmptyFileDiffMessage,
  decodeUtf8OrNull
} from '../gitDiffFormatter'

describe('buildUntrackedDiff', () => {
  it('複数行のファイル内容から疑似 unified diff を組み立てる', () => {
    const result = buildUntrackedDiff('new.txt', 'line1\nline2\n')
    expect(result).toBe(
      'diff --git a/new.txt b/new.txt\n' +
        'new file mode 100644\n' +
        '--- /dev/null\n' +
        '+++ b/new.txt\n' +
        '@@ -0,0 +1,2 @@\n' +
        '+line1\n' +
        '+line2\n'
    )
  })

  it('空ファイルの場合、ハンク(@@)を含まないヘッダのみを返す', () => {
    // @@ -0,0 +1,0 @@ という「0行追加」のハンクをボディ無しで送ると、
    // git apply が不正なパッチ(corrupt patch)として拒否してしまう
    // (実際に `git apply --cached` で再現確認済み)。空ファイルの新規作成は
    // ハンク自体を省略した diff で正しく表現できる
    const result = buildUntrackedDiff('empty.txt', '')
    expect(result).toBe(
      'diff --git a/empty.txt b/empty.txt\n' +
        'new file mode 100644\n' +
        '--- /dev/null\n' +
        '+++ b/empty.txt\n'
    )
  })

  it('末尾に改行が無いファイルでも最終行を欠かさない', () => {
    const result = buildUntrackedDiff('new.txt', 'line1\nline2')
    expect(result).toContain('+line1')
    expect(result).toContain('+line2')
    expect(result).toContain('@@ -0,0 +1,2 @@')
  })

  it('末尾に改行が無いファイルは "\\ No newline at end of file" マーカーを付け、無い改行を実在するかのように装わない', () => {
    // マーカーを付けないと、この疑似diffを git apply --cached したとき index 側の
    // blob に実ファイルには無い改行が混入し、index と working tree の内容が乖離する
    const result = buildUntrackedDiff('new.txt', 'line1\nline2')
    expect(result).toBe(
      'diff --git a/new.txt b/new.txt\n' +
        'new file mode 100644\n' +
        '--- /dev/null\n' +
        '+++ b/new.txt\n' +
        '@@ -0,0 +1,2 @@\n' +
        '+line1\n' +
        '+line2\n' +
        '\\ No newline at end of file\n'
    )
  })

  it('isExecutable=true の場合、file mode を 100755 にする', () => {
    // 100644 固定のままだと、stageHunk 経由でこの疑似diffを git apply --cached
    // したとき、実行可能な新規ファイル(シェルスクリプト等)の実行ビットが
    // index 上で失われてしまう
    const result = buildUntrackedDiff('run.sh', '#!/bin/sh\n', true)
    expect(result).toContain('new file mode 100755\n')
  })

  it('isExecutable を省略した場合は従来通り 100644 になる', () => {
    const result = buildUntrackedDiff('new.txt', 'line1\n')
    expect(result).toContain('new file mode 100644\n')
  })

  it('ファイル名に改行を含む場合、diff ヘッダを組み立てず専用メッセージを返す', () => {
    // filePath はヘッダ行(diff --git a/... b/... 等)へそのまま埋め込まれる。
    // POSIX では改行もファイル名に使える文字だが、埋め込むとヘッダ行自体が
    // 複数行に割れ、git apply --cached に渡すと不正なパッチとして拒否される
    // (または意図しないハンクとして誤解釈されうる)。gitignoreService.ts の
    // addToGitignore が同種のリスクに対して改行を含むパスを拒否しているのと
    // 同じ理由で、疑似diff を組み立てる前に弾く
    const result = buildUntrackedDiff('foo\nbar.txt', 'content\n')
    expect(result).not.toContain('diff --git')
    expect(result).toContain('foo\\nbar.txt')
  })
})

describe('isBinaryContent', () => {
  it('NULバイトを含むバッファはバイナリと判定する', () => {
    expect(isBinaryContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true)
  })

  it('NULバイトを含まないテキストのバッファはバイナリと判定しない', () => {
    expect(isBinaryContent(Buffer.from('line1\nline2\n', 'utf-8'))).toBe(false)
  })

  it('空のバッファはバイナリと判定しない', () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false)
  })

  it('先頭8000バイトより後にあるNULバイトは判定に使わない(gitの挙動に合わせる)', () => {
    const buf = Buffer.alloc(8100, 0x61) // 'a' で埋める
    buf[8050] = 0x00
    expect(isBinaryContent(buf)).toBe(false)
  })
})

describe('decodeUtf8OrNull', () => {
  it('正当なUTF-8(日本語含む)のバッファはデコード結果の文字列を返す', () => {
    expect(decodeUtf8OrNull(Buffer.from('こんにちは\nworld\n', 'utf-8'))).toBe(
      'こんにちは\nworld\n'
    )
  })

  it('Shift_JISでエンコードされたバッファ(UTF-8として不正なバイト列)は null を返す', () => {
    // NULバイトを含まないため isBinaryContent はバイナリと判定しない。
    // しかし buffer.toString('utf-8') でデコードすると不正なバイト列が
    // U+FFFD に置換され、元のバイト列とは異なる内容になってしまう。
    // それを気づかず git apply --cached すると、破損した内容が
    // そのままインデックスにステージされる(データ破損)。
    // isValidUtf8(バリデーションのみ)と gitService.ts 側の buffer.toString('utf-8')
    // (実際のデコード)が同じ内容を2回デコードしていたため、1回のデコードで
    // 両方を兼ねる関数に統合した
    const shiftJisBytes = Buffer.from([0x82, 0xa0, 0x82, 0xa2]) // "あい" の Shift_JIS
    expect(decodeUtf8OrNull(shiftJisBytes)).toBeNull()
  })

  it('空のバッファは空文字列を返す', () => {
    expect(decodeUtf8OrNull(Buffer.alloc(0))).toBe('')
  })

  it('先頭にUTF-8 BOMを含むバッファは、BOMを保持したままデコードする', () => {
    // ignoreBOM を指定しない TextDecoder はデフォルトで BOM を検出し消費して
    // 除去する。ここで BOM を落とすと、この結果を疑似diff化して
    // git apply --cached したとき index 側の内容から BOM が失われ、
    // BOM 付きのまま残る working tree の実ファイルと食い違ってしまう
    // (staging 後も diff が永久に残り続ける)
    const bomPrefixedBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('hello\n', 'utf-8')
    ])
    expect(decodeUtf8OrNull(bomPrefixedBytes)).toBe('\uFEFFhello\n')
  })
})

describe('buildBinaryDiffMessage', () => {
  it('git の "Binary files ... differ" 形式のメッセージを組み立てる', () => {
    const result = buildBinaryDiffMessage('image.png')
    expect(result).toBe('Binary files /dev/null and b/image.png differ\n')
  })
})

describe('buildSymlinkDiffMessage', () => {
  it('シンボリックリンクはステージ非対応であることを示すメッセージを組み立てる', () => {
    // シンボリックリンクを readFile で読むとリンク先の実体の内容を読んでしまい、
    // それを疑似diff化して git apply --cached すると、実体の内容がコピーされた
    // 通常ファイルとしてステージされてしまう(シンボリックリンクとしての
    // git 上の表現(mode 120000、リンク先パスそのものが blob 内容)にならない)。
    // 疑似diff を組み立てず、ステージできないことを明示する
    const result = buildSymlinkDiffMessage('link.txt')
    expect(result).toBe('シンボリックリンクの差分表示・ステージには対応していません: link.txt\n')
  })
})

describe('buildEmptyFileDiffMessage', () => {
  it('空ファイルであることを示すメッセージを組み立てる', () => {
    // 空ファイルはハンク(@@)を持てない(0行追加のハンクを送ると git apply が
    // corrupt patch として拒否する)ため、ヘッダのみの diff を返していたが、
    // DiffView はハンクが無い diff のヘッダ行をそのまま画面に描画するため、
    // "diff --git a/x b/x" などの内部表現がユーザーに露出してしまっていた。
    // バイナリ/シンボリックリンク/サイズ超過と同じく 1 行のメッセージにする
    const result = buildEmptyFileDiffMessage('empty.txt')
    expect(result).toBe('空のファイルのため表示する差分はありません: empty.txt\n')
  })
})

describe('buildTooLargeDiffMessage', () => {
  it('サイズ上限超過であることを示すメッセージを組み立てる', () => {
    const result = buildTooLargeDiffMessage('huge.log')
    expect(result).toBe('ファイルサイズが大きすぎるため差分を表示できません: huge.log\n')
  })
})
