'use client'
import type { ExternalChangeBannerState } from '../../hooks/useExternalFileChanges'

interface Props {
  /** 通知が無い間は null */
  banner: ExternalChangeBannerState | null
}

function externalChangeMessage(banner: ExternalChangeBannerState | null): string {
  if (banner === null) return ''
  return banner.kind === 'modified'
    ? 'ディスク上のファイルが変更されました（エージェントなどによる変更）。'
    : 'ディスク上のファイルが削除されました。'
}

// 編集中のタブのファイルがディスク上で変わった・削除されたときの通知の帯(設計書「編集中のタブへの通知」)。見た目の帯と
// ボタンだけを出し、読み上げは ExternalChangeAnnouncer が行う(ターミナルの最大化で隠れるタブと本文の外に置くため)
export default function ExternalChangeBanner({ banner }: Props): React.JSX.Element | null {
  if (banner === null) return null
  return (
    <div className="external-change-banner">
      {/* 同じ文言は ExternalChangeAnnouncer が支援技術へ伝えるため、二重に読まれないよう隠す */}
      <span className="external-change-banner__message" aria-hidden="true">
        {externalChangeMessage(banner)}
      </span>
      <span className="external-change-banner__actions">
        {banner.reload !== null && (
          <button type="button" className="external-change-banner__button" onClick={banner.reload}>
            ディスクの内容を読み込む
          </button>
        )}
        <button type="button" className="external-change-banner__button" onClick={banner.dismiss}>
          このまま編集する
        </button>
      </span>
    </div>
  )
}

// 通知の文言の読み上げ(視覚的には隠す)。文言ごと挿入されると読み上げられないことがあるため、通知が無い間も空のまま置き、
// 同じ要素に文言を入れる(パターン 87)。role="status" は付けず aria-live="polite"・aria-atomic で同じ読み上げにする(エディタの
// 領域には出力パネルの常設の role="status" があり、同じ role を常設すると重なるため)。EditorPanel がタブと本文
// (.editor-panel__main)の外に常設し、ターミナルの最大化の間も読み上げる
export function ExternalChangeAnnouncer({ banner }: Props): React.JSX.Element {
  return (
    <span className="external-change-banner__live" aria-live="polite" aria-atomic="true">
      {externalChangeMessage(banner)}
    </span>
  )
}
