import { describe, it, expect } from 'vitest'
import { assertHunkPatchTargets, stripModeChangeLines } from '../gitHunkPatch'

const MISMATCH = 'パッチの対象がファイルと一致しません'

const HUNK = ['@@ -1,3 +1,3 @@', ' x', '-y', '+PWNED', ' z'].join('\n')
const patchOf = (headerLines: string[], body = HUNK): string =>
  [...headerLines, body].join('\n') + '\n'
const normalHeader = (a = 'f.txt', b = 'f.txt'): string[] => [
  `diff --git a/${a} b/${b}`,
  'index 1111111..2222222 100644',
  `--- a/${a}`,
  `+++ b/${b}`
]

describe('assertHunkPatchTargets', () => {
  describe('許可するパッチ', () => {
    it('通常の 1 ハンクのパッチ', () => {
      expect(() => assertHunkPatchTargets(patchOf(normalHeader()), 'f.txt')).not.toThrow()
    })

    it('複数ハンクを含み、"No newline" 行があるパッチ', () => {
      const body = [HUNK, '@@ -10 +10 @@', '-a', '\\ No newline at end of file', '+b'].join('\n')
      expect(() => assertHunkPatchTargets(patchOf(normalHeader(), body), 'f.txt')).not.toThrow()
    })

    // 内容変更 + chmod +x の diff。index 行はモードが付かない形になる(実機で確認)
    const modeChangeHeader = (): string[] => [
      'diff --git a/f.txt b/f.txt',
      'old mode 100644',
      'new mode 100755',
      'index 1111111..2222222',
      '--- a/f.txt',
      '+++ b/f.txt'
    ]

    it('モード変更(old mode → new mode の 1 組)つきのパッチ', () => {
      expect(() => assertHunkPatchTargets(patchOf(modeChangeHeader()), 'f.txt')).not.toThrow()
    })

    it('本文に空行(コンテキストの空行は " " 1 文字)を含むパッチ', () => {
      const body = ['@@ -1,3 +1,3 @@', ' x', ' ', '-y', '+PWNED'].join('\n')
      expect(() => assertHunkPatchTargets(patchOf(normalHeader(), body), 'f.txt')).not.toThrow()
    })

    it.each([
      ['100644', 'index abc1234..0000000'],
      ['100644', 'index abc1234..0000000 100644'],
      ['100755', 'index abc1234..0000000 100755']
    ])('削除: deleted file mode %s と %s は許可する(モード無し、または一致)', (mode, indexLine) => {
      const header = [
        'diff --git a/f.txt b/f.txt',
        `deleted file mode ${mode}`,
        indexLine,
        '--- a/f.txt',
        '+++ /dev/null'
      ]
      expect(() =>
        assertHunkPatchTargets(patchOf(header, '@@ -1 +0,0 @@\n-a'), 'f.txt')
      ).not.toThrow()
    })

    it('index 行にモードが付いていても許可する', () => {
      const header = normalHeader()
      header[1] = 'index 1111111..2222222 100755'
      expect(() => assertHunkPatchTargets(patchOf(header), 'f.txt')).not.toThrow()
    })

    it('作業ツリーで削除されたファイル(deleted file mode と +++ /dev/null)', () => {
      const header = [
        'diff --git a/f.txt b/f.txt',
        'deleted file mode 100644',
        'index 1111111..0000000',
        '--- a/f.txt',
        '+++ /dev/null'
      ]
      expect(() =>
        assertHunkPatchTargets(patchOf(header, '@@ -1 +0,0 @@\n-a'), 'f.txt')
      ).not.toThrow()
    })

    it('空白を含むパス(--- / +++ の末尾にタブが付く)', () => {
      const header = [
        'diff --git a/sp ace.txt b/sp ace.txt',
        'index 1111111..2222222 100644',
        '--- a/sp ace.txt\t',
        '+++ b/sp ace.txt\t'
      ]
      expect(() => assertHunkPatchTargets(patchOf(header), 'sp ace.txt')).not.toThrow()
    })

    // core.quotepath の既定では非 ASCII のパスは 8 進エスケープの引用符つきで出る(実機で確認)
    it('日本語のパス(引用符つき・8 進エスケープ)', () => {
      const q = '"a/\\346\\227\\245\\346\\234\\254\\350\\252\\236.txt"'
      const qb = q.replace('"a/', '"b/')
      const header = [
        'diff --git ' + q + ' ' + qb,
        'index 1111111..2222222 100644',
        '--- ' + q,
        '+++ ' + qb
      ]
      expect(() => assertHunkPatchTargets(patchOf(header), '日本語.txt')).not.toThrow()
    })

    it('引用符を含むパス(\\" のエスケープ)', () => {
      const header = [
        'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
        'index 1111111..2222222 100644',
        '--- "a/q\\"uote.txt"',
        '+++ "b/q\\"uote.txt"'
      ]
      expect(() => assertHunkPatchTargets(patchOf(header), 'q"uote.txt')).not.toThrow()
    })

    it('引用符なしの日本語(core.quotepath=false)', () => {
      expect(() =>
        assertHunkPatchTargets(patchOf(normalHeader('日本語.txt', '日本語.txt')), '日本語.txt')
      ).not.toThrow()
    })
  })

  describe('拒否するパッチ', () => {
    const expectRejected = (patch: string, filePath = 'f.txt'): void => {
      expect(() => assertHunkPatchTargets(patch, filePath)).toThrow(MISMATCH)
    }
    const withExtra = (extra: string, at = 1): string => {
      const header = normalHeader()
      header.splice(at, 0, extra)
      return patchOf(header)
    }

    it.each([
      'rename old evil.sh',
      'rename new f.txt',
      'rename from evil.sh',
      'rename to f.txt',
      'copy from evil.sh',
      'copy to f.txt',
      'similarity index 50%',
      'dissimilarity index 50%',
      'new file mode 100644',
      'Binary files a/f.txt and b/f.txt differ',
      'GIT binary patch',
      'unknown header'
    ])('@@ より前の許可していない行(%s)', (line) => {
      expectRejected(withExtra(line))
    })

    it('rename old / new で別ファイルから書き換えるパッチ(再現した攻撃)', () => {
      const patch = [
        'diff --git a/evil.sh b/f.txt',
        'similarity index 50%',
        'rename old evil.sh',
        'rename new f.txt',
        '--- a/evil.sh',
        '+++ b/f.txt',
        HUNK,
        ''
      ].join('\n')
      expectRejected(patch)
    })

    it('rename 行が無く、a と b のパスだけが異なるパッチ(再現した攻撃)', () => {
      expectRejected(patchOf(normalHeader('other.txt', 'f.txt')))
    })

    it('a 側のパスが違う(a/other.txt b/f.txt)', () => {
      expectRejected(patchOf(['diff --git a/other.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt']))
    })

    it('b 側のパスが違う(a/f.txt b/other.txt)', () => {
      expectRejected(patchOf(['diff --git a/f.txt b/other.txt', '--- a/f.txt', '+++ b/f.txt']))
    })

    it('--- と +++ のパスが食い違う', () => {
      expectRejected(patchOf(['diff --git a/f.txt b/f.txt', '--- a/other.txt', '+++ b/f.txt']))
      expectRejected(patchOf(['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/other.txt']))
    })

    it('対象のパスと違う(f.txt のパッチを g.txt の取り消しに使う)', () => {
      expectRejected(patchOf(normalHeader()), 'g.txt')
    })

    it('ヘッダーのパスが filePath と異なる(a/../f.txt は f.txt と別のパス)', () => {
      expectRejected(patchOf(normalHeader('../f.txt', '../f.txt')))
      expectRejected(patchOf(normalHeader('d/../f.txt', 'd/../f.txt')), 'f.txt')
    })

    it('filePath 自体が .. を含む・絶対パスのときは、ヘッダーが一致していても拒否する', () => {
      expectRejected(patchOf(normalHeader('../f.txt', '../f.txt')), '../f.txt')
      expectRejected(patchOf(normalHeader('d/../f.txt', 'd/../f.txt')), 'd/../f.txt')
      expectRejected(patchOf(normalHeader('/etc/f', '/etc/f')), '/etc/f')
    })

    it.each([
      ['old mode だけ', ['old mode 100644']],
      ['new mode だけ', ['new mode 100755']],
      ['new → old の順', ['new mode 100755', 'old mode 100644']],
      ['2 組', ['old mode 100644', 'new mode 100755', 'old mode 100755', 'new mode 100644']]
    ])('モード変更が不正(%s)', (_name, modeLines) => {
      const header = normalHeader()
      header.splice(1, 0, ...modeLines)
      expectRejected(patchOf(header))
    })

    it('@@ より後ろの mode 行は拒否する', () => {
      expectRejected(patchOf(normalHeader(), HUNK + '\nold mode 100644\nnew mode 100755'))
    })

    it('削除(deleted file mode)とモード変更の組み合わせは拒否する', () => {
      expectRejected(
        patchOf(
          [
            'diff --git a/f.txt b/f.txt',
            'old mode 100644',
            'new mode 100755',
            'deleted file mode 100644',
            '--- a/f.txt',
            '+++ /dev/null'
          ],
          '@@ -1 +0,0 @@\n-a'
        )
      )
    })

    // 120000(シンボリックリンク)や 160000(サブモジュール)で復元させない
    it.each(['120000', '160000', '100664', '040000'])('deleted file mode %s は拒否する', (mode) => {
      expectRejected(
        patchOf(
          [
            'diff --git a/f.txt b/f.txt',
            `deleted file mode ${mode}`,
            '--- a/f.txt',
            '+++ /dev/null'
          ],
          '@@ -1 +0,0 @@\n-other.txt'
        )
      )
    })

    it('diff --git が 2 つ', () => {
      const second = ['diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt', HUNK]
      expectRejected(patchOf(normalHeader(), [HUNK, ...second].join('\n')))
      expectRejected(patchOf([...normalHeader(), 'diff --git a/f.txt b/f.txt']))
    })

    it('新規作成のパッチ(new file mode / --- /dev/null)', () => {
      expectRejected(
        patchOf(
          ['diff --git a/f.txt b/f.txt', 'new file mode 100644', '--- /dev/null', '+++ b/f.txt'],
          '@@ -0,0 +1 @@\n+a'
        )
      )
      expectRejected(patchOf(['diff --git a/f.txt b/f.txt', '--- /dev/null', '+++ b/f.txt']))
    })

    it('deleted file mode が無いのに +++ /dev/null', () => {
      expectRejected(patchOf(['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ /dev/null']))
    })

    const deletedPatch = (deletedMode: string, indexLine: string): string =>
      patchOf(
        [
          'diff --git a/f.txt b/f.txt',
          `deleted file mode ${deletedMode}`,
          indexLine,
          '--- a/f.txt',
          '+++ /dev/null'
        ],
        '@@ -1 +0,0 @@\n-a'
      )

    // git apply は index 行のモードを old_mode として採用するため、deleted file mode を
    // 通常ファイルに限っても、index 行で 120000 を指定すると任意のリンクとして復元できてしまう
    it.each([
      ['100644', 'index 1234567..0000000 120000'],
      ['100644', 'index 1234567..0000000 160000'],
      ['100644', 'index 1234567..0000000 100755'],
      ['100755', 'index 1234567..0000000 100644'],
      ['100644', 'index 1234567..0000000 12']
    ])(
      'deleted file mode %s で index 行のモードが一致しない(%s)ときは拒否する',
      (mode, indexLine) => {
        expectRejected(deletedPatch(mode, indexLine))
      }
    )

    it('deleted file mode があるのに +++ b/<path>', () => {
      expectRejected(
        patchOf([
          'diff --git a/f.txt b/f.txt',
          'deleted file mode 100644',
          '--- a/f.txt',
          '+++ b/f.txt'
        ])
      )
    })

    it('ハンクが無い・空のパッチ', () => {
      expectRejected('')
      expectRejected(normalHeader().join('\n') + '\n')
    })

    it('--- / +++ が欠けている', () => {
      expectRejected(patchOf(['diff --git a/f.txt b/f.txt', 'index 1111111..2222222 100644']))
    })

    it('ハンク本文に許可していない行(diff --git や空行)が混ざる', () => {
      expectRejected(patchOf(normalHeader(), HUNK + '\ndiff --git a/g.txt b/g.txt'))
      expectRejected(patchOf(normalHeader(), HUNK + '\n\n x'))
    })

    it('ハンクの行数が見出しと一致しない(後ろに別ファイルのヘッダーを紛れ込ませる)', () => {
      const smuggled = [HUNK, '--- a/other.txt', '+++ b/other.txt', '@@ -1 +1 @@', '-a', '+b'].join(
        '\n'
      )
      expectRejected(patchOf(normalHeader(), smuggled))
      expectRejected(patchOf(normalHeader(), '@@ -1,3 +1,3 @@\n x\n-y\n+PWNED'))
    })

    it('引用符つきのパスのデコード結果が違う、または不正なエスケープ', () => {
      expectRejected(
        patchOf([
          'diff --git "a/\\346.txt" "b/\\346.txt"',
          '--- "a/\\346.txt"',
          '+++ "b/\\346.txt"'
        ]),
        'f.txt'
      )
      expectRejected(
        patchOf(['diff --git "a/f\\q.txt" "b/f\\q.txt"', '--- "a/f\\q.txt"', '+++ "b/f\\q.txt"'])
      )
    })
  })
})

describe('stripModeChangeLines', () => {
  it('ヘッダーの old mode / new mode の 2 行だけを取り除く', () => {
    const patch = [
      'diff --git a/f.txt b/f.txt',
      'old mode 100644',
      'new mode 100755',
      'index 1111111..2222222',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      ''
    ].join('\n')
    expect(stripModeChangeLines(patch)).toBe(
      [
        'diff --git a/f.txt b/f.txt',
        'index 1111111..2222222',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        ''
      ].join('\n')
    )
  })

  it('モード変更が無いパッチはそのまま返す', () => {
    const patch = patchOf(normalHeader())
    expect(stripModeChangeLines(patch)).toBe(patch)
  })

  it('ハンク本文の中の "old mode ..." に見える行(先頭が +/-/空白)は触らない', () => {
    const body = ['@@ -1 +1 @@', '-old mode 100644', '+new mode 100755'].join('\n')
    const patch = patchOf(normalHeader(), body)
    expect(stripModeChangeLines(patch)).toBe(patch)
  })
})
