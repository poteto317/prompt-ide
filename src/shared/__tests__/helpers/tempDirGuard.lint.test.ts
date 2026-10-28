import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'

// テストの再帰削除をガードに通す ESLint の規則(eslint.config.mjs の no-restricted-syntax)を、実際の設定で確かめる。
// RuleTester ではなく実際の設定を読むのは、files・ignores の globs が効いているかも確かめるため(L-618)

const REPO_ROOT = resolve(__dirname, '../../../..')
const LINT_TIMEOUT_MS = 30_000
const eslint = new ESLint({ cwd: REPO_ROOT })

/** code を filePath のファイルとして lint し、no-restricted-syntax のメッセージだけを返す */
const restrictedMessages = async (code: string, filePath: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: resolve(REPO_ROOT, filePath) })
  // 構文の誤りで 0 件になり、「検出しない」の確かめが素通りしないよう、構文の誤りが無いことも確かめる
  expect(result.messages.filter((message) => message.fatal === true)).toEqual([])
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message)
}

const TEST_FILE_PATHS = [
  'src/main/__tests__/x.test.ts',
  'src/renderer/src/lib/__tests__/x.test.tsx',
  'src/main/__tests__/helpers/x.ts',
  'scripts/__tests__/x.test.mjs'
]

const RECURSIVE_RM = 'rmSync(dir, { recursive: true, force: true })'

// リポジトリの実際のファイルに規則をかけるときに渡すフォルダ。どのファイルに規則がかかるかは、
// eslint.config.mjs の規則のブロックの files・ignores に任せる(globs を写すと、files を変えたときにずれても気づけない)。
// npm run lint は main からある別の規則のエラーで普段は通らないので、npm test で規則の違反を止めるために使う
const REPO_LINT_TARGETS = ['src', 'scripts']
// フォルダの下を全部 lint するので、ほかの件より長くする(手元で約 3 秒)
const REPO_LINT_TIMEOUT_MS = 120_000
// 対象の集め方が壊れてテストのファイルが lint されず、違反 0 件が素通りしないための下限(今は 600 を超える)
const MIN_LINTED_TEST_FILES = 100
const TEST_FILE_PATTERN = /(__tests__\/|\.test\.)/

const DETECTED: Array<[string, string]> = [
  ['rmSync の recursive', RECURSIVE_RM],
  ['fs.rmSync の recursive', 'fs.rmSync(dir, { recursive: true })'],
  ['fs.promises.rm の recursive', 'void fs.promises.rm(dir, { recursive: true })'],
  ['await rm の recursive', 'const f = async () => { await rm(dir, { recursive: true }) }'],
  ['rmdirSync の recursive', 'rmdirSync(dir, { recursive: true })'],
  ['文字列のキーの recursive', "rmSync(dir, { 'recursive': true })"],
  ['recursive: false(再帰しないなら欄を書かない)', 'rmSync(dir, { recursive: false })']
]

const NOT_DETECTED: Array<[string, string]> = [
  ['removeTempPathSync', 'removeTempPathSync(dir)'],
  ['await removeTempPath', 'const f = async () => { await removeTempPath(dir) }'],
  ['1 つのファイルを消す rmSync', "rmSync(join(dir, 'f.txt'))"],
  ['force だけの rmSync', 'rmSync(file, { force: true })'],
  ['mkdirSync の recursive', 'mkdirSync(dir, { recursive: true })'],
  ['cpSync の recursive', 'cpSync(a, b, { recursive: true })'],
  [
    'toHaveBeenCalledWith の recursive',
    "expect(mockRm).toHaveBeenCalledWith('/x', { recursive: true })"
  ]
]

// 既知の制約(eslint.config.mjs のコメント)の形。今は検出しないことを固定し、規則を強めたときにコメントの更新漏れに気づけるようにする
const KNOWN_ESCAPES: Array<[string, string]> = [
  ['オプションを変数で渡す', 'rmSync(dir, opts)'],
  ['スプレッド', 'rmSync(dir, { ...opts })'],
  ['別名の import', 'remove(dir, { recursive: true })'],
  ['別名の分割代入', 'const { rmSync: remove } = fs; remove(dir, { recursive: true })'],
  ['計算されたキー', 'rmSync(dir, { [key]: true })'],
  ['計算されたメンバー', "fs['rmSync'](dir, { recursive: true })"],
  ['型の表明(as)', 'rmSync(dir, { recursive: true } as RmOptions)'],
  ['型の表明(satisfies)', 'rmSync(dir, { recursive: true } satisfies RmOptions)'],
  ['rimraf(オプションなしで再帰する)', 'void rimraf(dir)'],
  ['fs-extra の removeSync(オプションなしで再帰する)', 'removeSync(dir)']
]

describe('テストの再帰削除の ESLint の規則', () => {
  it.each(KNOWN_ESCAPES)(
    '既知の制約: %s は今は検出しない',
    async (_label, code) => {
      expect(await restrictedMessages(code, 'src/main/__tests__/x.test.ts')).toEqual([])
    },
    LINT_TIMEOUT_MS
  )

  describe.each(TEST_FILE_PATHS)('テストのファイル %s', (filePath) => {
    it.each(DETECTED)(
      '%s を検出し、ガードを案内する',
      async (_label, code) => {
        expect(await restrictedMessages(code, filePath)).toEqual([
          expect.stringContaining('removeTempPathSync')
        ])
      },
      LINT_TIMEOUT_MS
    )

    it.each(NOT_DETECTED)(
      '%s は検出しない',
      async (_label, code) => {
        expect(await restrictedMessages(code, filePath)).toEqual([])
      },
      LINT_TIMEOUT_MS
    )
  })

  it.each<[string, string, number]>([
    ['ガードの実装(除外)', 'src/shared/__tests__/helpers/tempDirGuard.ts', 0],
    ['本番のコード(テストのファイルだけにかける)', 'src/main/foo.ts', 0],
    ['ガードの単体テスト(除外しない)', 'src/shared/__tests__/helpers/tempDirGuard.test.ts', 1],
    ['ガードと同じフォルダのほかの補助(除外しない)', 'src/shared/__tests__/helpers/other.ts', 1]
  ])(
    '%s(%s)での素の再帰削除の検出は %s 件',
    async (_label, filePath, expected) => {
      expect(await restrictedMessages(RECURSIVE_RM, filePath)).toHaveLength(expected)
    },
    LINT_TIMEOUT_MS
  )

  it(
    'リポジトリの src・scripts の全部(規則がかかるのは設定の files のファイル)で、素の再帰削除の違反が 0 件',
    async () => {
      // ほかの規則のエラーは見ない(main からあるものがある)。この規則だけを流して速くする
      const repoEslint = new ESLint({
        cwd: REPO_ROOT,
        cache: false,
        ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-syntax'
      })
      const results = await repoEslint.lintFiles(REPO_LINT_TARGETS)
      expect(
        results.filter((result) => TEST_FILE_PATTERN.test(result.filePath)).length
      ).toBeGreaterThan(MIN_LINTED_TEST_FILES)
      const violations = results.flatMap((result) =>
        result.messages
          .filter((message) => message.ruleId === 'no-restricted-syntax')
          .map((message) => `${result.filePath}:${message.line}`)
      )
      expect(violations).toEqual([])
    },
    REPO_LINT_TIMEOUT_MS
  )
})
