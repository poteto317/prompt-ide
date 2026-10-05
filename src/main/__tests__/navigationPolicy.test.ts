import { describe, it, expect } from 'vitest'
import { isAllowedNavigation, toExternalHref } from '../navigationPolicy'

describe('isAllowedNavigation', () => {
  const devUrl = 'http://localhost:5173/'
  const fileUrl =
    'file:///Applications/prompt-ide.app/Contents/Resources/app.asar/out/renderer/index.html'
  it.each([
    ['開発時: 同じ origin は許す', 'http://localhost:5173/#x', devUrl, true],
    ['開発時: 別のポートは拒否', 'http://localhost:5174/', devUrl, false],
    ['開発時: 外部のサイトは拒否', 'https://example.com/', devUrl, false],
    ['パッケージ版: 同じ index.html は許す', `${fileUrl}?a=1#b`, fileUrl, true],
    ['パッケージ版: 別のファイルは拒否', 'file:///etc/passwd', fileUrl, false],
    [
      'パッケージ版: 別のホストの同じパスは拒否(Windows では UNC になる)',
      'file://evil/Applications/prompt-ide.app/Contents/Resources/app.asar/out/renderer/index.html',
      fileUrl,
      false
    ],
    ['パッケージ版: http は拒否', 'https://example.com/', fileUrl, false],
    ['解析できない URL は拒否', '::', devUrl, false]
  ])('%s', (_label, target, app, expected) => {
    expect(isAllowedNavigation(target, app)).toBe(expected)
  })
})

describe('toExternalHref', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/a?b=1#c', 'http://example.com/a?b=1#c'],
    ['HTTPS://Example.com/', 'https://example.com/'],
    ['https://a.com\\@evil.com', 'https://a.com/@evil.com']
  ])('%s は正規化した href を返す', (raw, expected) => {
    expect(toExternalHref(raw)).toBe(expected)
  })

  it.each([
    ['前の空白', ' https://a.com'],
    ['後ろの空白', 'https://a.com '],
    ['文字列中の改行', 'htt\nps://a.com'],
    ['文字列中のタブ', 'https://a.com/\tb'],
    ['文字列中の空白', 'https://a.com/a b'],
    ['制御文字', 'https://a.com/\u0001'],
    ['DEL', 'https://a.com/\u007f'],
    ['// から始まる', '//a.com'],
    ['ホスト無し', 'https://'],
    ['スラッシュ無し', 'https:example.com'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['javascript:', 'javascript:alert(1)'],
    ['file:', 'file:///etc/passwd'],
    ['独自スキーム', 'x-custom://a'],
    ['空文字', ''],
    ['巨大な入力', `https://a.com/${'a'.repeat(5000)}`]
  ])('%s は null', (_label, raw) => {
    expect(toExternalHref(raw)).toBeNull()
  })
})
