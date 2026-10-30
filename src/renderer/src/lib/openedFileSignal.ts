import { toComparablePath } from './pathUtils'

// ファイルを「開いた」ことを伝える信号(useFileSystem の openedFileSignal)の型と、イベントを足す純粋な関数。
// リネームでも openFile.path は変わるため、path の変化だけでは open と区別できない。そのため開くたびに
// 進む id と対象のパスを持つイベントの列で伝える(受け手は useQuickOpen・useEditorFocusManager)

/**
 * 信号に保持するイベント数。消費側が同じレンダーまで処理できないことがあるため、
 * 消費側(useQuickOpen)が追跡する履歴の上限以上を保持する必要がある。
 * 同一パスは 1 件に畳むので、この数だけ「異なるファイル」を保持できる
 */
export const MAX_OPENED_FILE_EVENTS = 50

export interface OpenedFileEvent {
  /** ファイルを開くたびに増える。同じファイルを開き直しても進む */
  id: number
  /** 開いたファイルのパス */
  path: string
  /** この操作でエディタへフォーカスを移すか */
  moveFocusToEditor: boolean
}

export interface OpenedFileSignal {
  /**
   * 直近に開いたファイルの列(id 昇順)。1 件だけ保持すると、同じ React バッチで
   * 複数の読み込みが確定したときに中間のファイルを取りこぼす
   */
  events: OpenedFileEvent[]
}

/**
 * 信号の末尾にイベントを足した新しい信号を返す(prev は変えない)。同じパスの古いイベントは畳む。
 * 件数だけで切ると、重複を含んだ列が枠を埋めて中間の(本来保持すべき別ファイルの)履歴が落ちる。
 * Windows では表記だけ違うパスも同じファイルなので、正規化して比べる。末尾から max 件(1 以上)だけ残す
 */
export function appendOpenedFileEvent(
  prev: OpenedFileSignal,
  event: OpenedFileEvent,
  max: number = MAX_OPENED_FILE_EVENTS
): OpenedFileSignal {
  const openedKey = toComparablePath(event.path)
  return {
    events: [
      ...prev.events.filter((existing) => toComparablePath(existing.path) !== openedKey),
      event
    ].slice(-max)
  }
}
