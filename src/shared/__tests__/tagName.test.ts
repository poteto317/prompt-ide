import { describe, it, expect } from 'vitest'
import { getTagNameCollision, getTagNameRuleViolation, normalizeTagName } from '../tagName'

// 'é' の NFC(U+00E9 の 1 文字)と NFD(e + U+0301 の 2 文字)。見た目は同じだが文字列としては別物
const NFC_E = '\u00e9'
const NFD_E = 'e\u0301'

// タグ名の入口(main の createTag と renderer のダイアログ)が使う正規化。前後の空白を除き NFC にそろえる。
// check-ref-format --normalize は NFD をそのまま返すため、正規化しないと NFC の既存タグとの照合をすり抜ける
describe('normalizeTagName', () => {
  it('NFD を NFC に直す', () => {
    expect(normalizeTagName(`v1-${NFD_E}`)).toBe(`v1-${NFC_E}`)
  })

  it('NFC はそのまま', () => {
    expect(normalizeTagName(`v1-${NFC_E}`)).toBe(`v1-${NFC_E}`)
  })

  it('ASCII はそのまま', () => {
    expect(normalizeTagName('release/v1.0.0')).toBe('release/v1.0.0')
  })

  it('前後の空白を除いてから NFC に直す', () => {
    expect(normalizeTagName(`  ${NFD_E}\t\n`)).toBe(NFC_E)
  })

  // 全角英数字は NFC では変わらない(NFKC ではないため半角に寄せない)
  it('全角の文字は変えない', () => {
    expect(normalizeTagName('ｖ１')).toBe('ｖ１')
  })

  it('結合文字を含まない日本語は変えない', () => {
    expect(normalizeTagName('リリース/版')).toBe('リリース/版')
  })

  // 濁点の NFD(か + U+3099)は NFC の 'が' にそろう。既に NFC の 'が' は壊さない
  it('濁点の NFD は NFC にそろい、既に NFC のものは変わらない', () => {
    expect(normalizeTagName('\u304b\u3099')).toBe('\u304c')
    expect(normalizeTagName('\u304c')).toBe('\u304c')
  })
})

describe('getTagNameRuleViolation', () => {
  it('空文字は empty', () => {
    expect(getTagNameRuleViolation('')).toBe('empty')
  })

  // '-' 始まりは git(check-ref-format を含む)にオプションとして解釈される(パターン 21)
  it.each(['-x', '--force', '-'])("'-' で始まる名前 %s は leading-dash", (name) => {
    expect(getTagNameRuleViolation(name)).toBe('leading-dash')
  })

  // git tag は 'HEAD' を拒否し、'@' のタグは HEAD の解決を曖昧にする。'head' は大文字小文字を
  // 区別しない FS で .git/HEAD に隠れる(実機 git 2.50.1 で確認)
  it.each(['HEAD', 'head', 'Head', '@'])('%s は reserved', (name) => {
    expect(getTagNameRuleViolation(name)).toBe('reserved')
  })

  // git 本体の規則(`..` 等)は main 側の check-ref-format に委ねる
  it.each(['v1.0.0', 'release/2026-10', 'a-b', 'foo@bar', '@x', 'HEADS', 'my-head', 'a..b'])(
    '%s は null',
    (name) => {
      expect(getTagNameRuleViolation(name)).toBeNull()
    }
  )
})

// 既存のタグ・ブランチとの衝突。main(gitTagService)と renderer(tagValidation)が同じ順序で判定する
// ための共有の判定(片方だけ順序を変えると、ダイアログは通るのに main で拒否される。パターン 14)
describe('getTagNameCollision', () => {
  const conflict = (name: string, tags: string[]): ReturnType<typeof getTagNameCollision> =>
    getTagNameCollision(name, tags, [])
  const branch = (name: string, branches: string[]): ReturnType<typeof getTagNameCollision> =>
    getTagNameCollision(name, [], branches)

  describe('優先順位(完全一致のタグ → 衝突するタグ → 同名のブランチ)', () => {
    it('同名のタグと同名のブランチの両方があれば duplicate', () => {
      expect(getTagNameCollision('v1', ['v1'], ['v1'])).toEqual({ kind: 'duplicate', with: 'v1' })
    })

    it('完全一致のタグと、大文字小文字だけ違うタグの両方があれば duplicate', () => {
      expect(getTagNameCollision('v1', ['V1', 'v1'], [])).toEqual({
        kind: 'duplicate',
        with: 'v1'
      })
    })

    it('衝突するタグと同名のブランチの両方があれば conflict(with は衝突するタグ)', () => {
      expect(getTagNameCollision('V1', ['v1'], ['v1'])).toEqual({ kind: 'conflict', with: 'v1' })
    })

    it('同名のブランチだけなら branch(with は既存のブランチ)', () => {
      expect(getTagNameCollision('FEAT', ['v1'], ['main', 'feat'])).toEqual({
        kind: 'branch',
        with: 'feat'
      })
    })

    it('どれにも当たらなければ null', () => {
      expect(getTagNameCollision('v2', ['v1', 'v1/x'], ['main'])).toBeNull()
      expect(getTagNameCollision('v1', [], [])).toBeNull()
    })
  })

  // refs/tags 配下はディレクトリ構造のため、'v1' と 'v1/x' は共存できない
  // (git は `cannot lock ref` の英語エラーで失敗する)
  describe('衝突するタグ(conflict)', () => {
    it('既存のタグの配下になる名前は、その既存のタグと衝突する', () => {
      expect(conflict('v1/x', ['v1', 'v2'])).toEqual({ kind: 'conflict', with: 'v1' })
    })

    it('既存のタグを配下に持つ名前は、その既存のタグと衝突する', () => {
      expect(conflict('v1', ['v1/x'])).toEqual({ kind: 'conflict', with: 'v1/x' })
    })

    it('前方一致するだけの別名は衝突しない', () => {
      expect(conflict('v10', ['v1'])).toBeNull()
      expect(conflict('v1', ['v1.0'])).toBeNull()
      expect(conflict('v1-x', ['v1'])).toBeNull()
    })

    // 大文字小文字を区別しない FS では、packed-refs の 'v1' があると 'V1' が作れてしまい、
    // `git rev-parse v1` が 'V1' のコミットを返す(実機 git 2.50.1 で確認)。FS に依存させず一律に比べる
    it('大文字小文字だけが違う既存のタグと衝突する(両方の向き)', () => {
      expect(conflict('V1', ['v1'])).toEqual({ kind: 'conflict', with: 'v1' })
      expect(conflict('v1', ['V1'])).toEqual({ kind: 'conflict', with: 'V1' })
    })

    it('大文字小文字が違っても階層の衝突を検出する(両方の向き)', () => {
      expect(conflict('V1/x', ['v1'])).toEqual({ kind: 'conflict', with: 'v1' })
      expect(conflict('v1/x', ['V1'])).toEqual({ kind: 'conflict', with: 'V1' })
      expect(conflict('V1', ['v1/x'])).toEqual({ kind: 'conflict', with: 'v1/x' })
    })

    it('大文字小文字が違っても、前方一致するだけの別名は衝突しない', () => {
      expect(conflict('V10', ['v1'])).toBeNull()
      expect(conflict('v1', ['V1.0'])).toBeNull()
    })
  })

  // 同名のタグとブランチが共存すると、git merge <name> などがタグを優先する(パターン 43)。
  // 大文字小文字を区別しない FS では 'FEAT' のタグも 'feat' の解決を奪う(実機で確認)
  describe('同名のブランチ(branch)', () => {
    it('同じ名前のブランチと衝突する', () => {
      expect(branch('feat', ['main', 'feat'])).toEqual({ kind: 'branch', with: 'feat' })
    })

    it('大文字小文字だけ違うブランチとも衝突する(両方の向き)', () => {
      expect(branch('FEAT', ['feat'])).toEqual({ kind: 'branch', with: 'feat' })
      expect(branch('main', ['Main'])).toEqual({ kind: 'branch', with: 'Main' })
    })

    it('前方一致や階層の違う名前のブランチとは衝突しない', () => {
      expect(branch('feat', ['feature', 'feat/x', 'my-feat'])).toBeNull()
    })
  })

  // NFC と NFD は見た目が同じでも別の文字列。check-ref-format は NFD をそのまま通し、
  // core.precomposeunicode=false では packed-refs の NFC のタグの解決を NFD のタグが奪う(実機 git 2.50.1 で確認)。
  // 要求側・既存側の両方を NFC にそろえて比べる
  describe('Unicode の正規化(NFC / NFD)', () => {
    it('NFD の要求は NFC の既存タグと重複する', () => {
      expect(getTagNameCollision(NFD_E, [NFC_E], [])).toEqual({ kind: 'duplicate', with: NFC_E })
    })

    it('NFC の要求は NFD の既存タグと重複する', () => {
      expect(getTagNameCollision(NFC_E, [NFD_E], [])).toEqual({ kind: 'duplicate', with: NFD_E })
    })

    it('NFD 同士でも重複する', () => {
      expect(getTagNameCollision(NFD_E, [NFD_E], [])).toEqual({ kind: 'duplicate', with: NFD_E })
    })

    it('大文字小文字と正規化の両方が違っても衝突する', () => {
      const upperNfd = 'E\u0301'
      expect(getTagNameCollision(upperNfd, [NFC_E], [])).toEqual({
        kind: 'conflict',
        with: NFC_E
      })
      expect(getTagNameCollision(`${NFC_E}/x`, ['\u00c9'], [])).toEqual({
        kind: 'conflict',
        with: '\u00c9'
      })
    })

    it('階層の衝突も正規化して判定する', () => {
      expect(getTagNameCollision(`${NFD_E}/x`, [NFC_E], [])).toEqual({
        kind: 'conflict',
        with: NFC_E
      })
      expect(getTagNameCollision(NFC_E, [`${NFD_E}/x`], [])).toEqual({
        kind: 'conflict',
        with: `${NFD_E}/x`
      })
    })

    it('同名のブランチも正規化して判定する', () => {
      expect(getTagNameCollision(NFD_E, [], [NFC_E])).toEqual({ kind: 'branch', with: NFC_E })
      expect(getTagNameCollision(NFC_E, [], ['E\u0301'])).toEqual({
        kind: 'branch',
        with: 'E\u0301'
      })
    })
  })

  // macOS の APFS(大文字小文字を区別しない)は Unicode の完全な case folding で名前を比べる。
  // toLowerCase だけでは一致しない組がある。いずれも packed-refs の既存タグ(左)があると右のタグが終了コード 0 で
  // 作られ、`git rev-parse refs/tags/<左>` が新しいコミットを返す(実機 git 2.50.1 / APFS で確認)
  describe('完全な case folding(APFS が同じとみなす名前)', () => {
    it.each([
      ['ß', 'ss'],
      ['ss', 'ß'],
      ['SS', 'ß'],
      ['ẞ', 'ss'],
      ['ß', 'ẞ'],
      ['ΑΣ', 'ας'],
      ['ας', 'ασ'],
      ['ΟΔΟΣ', 'οδος'],
      ['ſ', 's'],
      ['S', 'ſ'],
      ['µ', 'μ'],
      ['Μ', 'µ'],
      ['ﬁ', 'fi'],
      ['ﬁ', 'FI'],
      ['ǅ', 'ǆ'],
      ['ǅ', 'Ǆ'],
      ['ϑ', 'θ'],
      ['ẛ', 'ṡ'],
      ['ᾳ', 'αι'],
      ['İ', 'i\u0307'],
      ['\u212a', 'k']
    ])('%s は既存のタグ %s と衝突する', (name, existing) => {
      expect(conflict(name, [existing])).toEqual({ kind: 'conflict', with: existing })
    })

    it('階層の衝突も case folding して判定する', () => {
      expect(conflict('ß/x', ['ss'])).toEqual({ kind: 'conflict', with: 'ss' })
      expect(conflict('ss', ['ß/x'])).toEqual({ kind: 'conflict', with: 'ß/x' })
    })

    it('同名のブランチも case folding して判定する', () => {
      expect(branch('ß', ['main', 'ss'])).toEqual({ kind: 'branch', with: 'ss' })
      expect(branch('ας', ['ΑΣ'])).toEqual({ kind: 'branch', with: 'ΑΣ' })
      expect(branch('ſ', ['s'])).toEqual({ kind: 'branch', with: 's' })
    })

    // APFS が別の名前として扱う組は衝突させない(過剰に拒否しない。実機 APFS で確認)
    it.each([
      ['ss1', 'ß2'],
      ['ı', 'i'],
      ['ı', 'I'],
      ['İ', 'i'],
      ['ａ', 'a'],
      ['σ', 'ο'],
      ['ss', 's']
    ])('%s と %s は衝突しない', (name, existing) => {
      expect(getTagNameCollision(name, [existing], [existing])).toBeNull()
    })

    it('ASCII や日本語の通常の名前は従来どおり判定する', () => {
      expect(conflict('リリース/版', ['リリース'])).toEqual({ kind: 'conflict', with: 'リリース' })
      expect(conflict('リリース', ['リリース2'])).toBeNull()
      expect(conflict('Release-1', ['release-1'])).toEqual({ kind: 'conflict', with: 'release-1' })
      expect(getTagNameCollision('v1.0', ['v1.0'], [])).toEqual({ kind: 'duplicate', with: 'v1.0' })
    })
  })
})
