// 遷移・新しいウィンドウ・外部リンクの許可(設計書「遷移と新しいウィンドウ」「リンク」)。純粋関数
import { isExternalHttpUrl } from '@shared/externalUrl'

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * アプリ自身の URL への遷移か。開発時(http の dev サーバー)は同じ origin、パッケージ版(file:)は同じホスト(通常は空)の
 * 同じ index.html のパスだけを許す(`file://evil/<同じパス>` は Windows では UNC になるため拒否する)(遷移した先のページに preload の API が渡らないように)
 */
export function isAllowedNavigation(targetUrl: string, appUrl: string): boolean {
  const target = parseUrl(targetUrl)
  const app = parseUrl(appUrl)
  if (target === null || app === null) return false
  if (app.protocol === 'file:')
    return (
      target.protocol === 'file:' && target.host === app.host && target.pathname === app.pathname
    )
  return target.origin === app.origin
}

const MAX_EXTERNAL_URL_LENGTH = 4096
// 空白・制御文字(U+0000-U+0020, U+007F-U+009F)。new URL() は前後の空白や \t \n を黙って除くため、
// 判定した文字列と OS に渡す文字列がずれないよう、含む入力は拒否する
function hasWhitespaceOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}
const HTTP_AUTHORITY_PREFIX = /^https?:\/\/[^/]/i

/**
 * 既定のブラウザへ渡してよい URL なら、判定に使った正規化済みの href を返す(渡すのはこの値。元の文字列ではない)。
 * http・https 以外、空白・制御文字を含むもの、`https:example.com` や `https://`(ホスト無し)、巨大な入力は null
 */
export function toExternalHref(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_EXTERNAL_URL_LENGTH) return null
  if (hasWhitespaceOrControl(raw)) return null
  if (!HTTP_AUTHORITY_PREFIX.test(raw)) return null
  if (!isExternalHttpUrl(raw)) return null
  const parsed = parseUrl(raw)
  if (parsed === null || parsed.hostname === '') return null
  return parsed.href
}
