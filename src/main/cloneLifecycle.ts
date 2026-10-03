import type { App } from 'electron'
import type { CloneRegistry } from './cloneRegistry'

// ウィンドウが閉じたら(webContents の destroyed)、そのウィンドウの clone を中止する(子プロセスを止め、作った保存先を
// 削除する)。アプリの終了で main プロセスごと止まる場合は、保存先に不完全なフォルダが残りうる(既知の制約)。
// Windows・Linux では最後のウィンドウを閉じるとアプリが終了する(index.ts の window-all-closed)ため、destroyed で中止の
// 依頼までは走るが、保存先の削除が終わる前に main が終了し、アプリの終了と同じく残りうる(既知の制約)。
// renderer のリロード(メニューの View > Reload など。メインフレームの別文書への遷移)でも中止する。clone を待つ画面が
// 消えた後に clone が成功すると、再読み込み後に開いたフォルダの許可が clone 先へ書き換わり、表示中のフォルダの保存・
// ファイル操作が全て拒否されるため。同じ文書内の遷移とサブフレームの遷移は画面が残るので中止しない。最初の読み込みでも
// 発火するが、その時点では実行中の clone が無いので何もしない
export function setupCloneLifecycle(app: App, registry: CloneRegistry): void {
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => registry.cancel(webContents.id))
    webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) registry.cancel(webContents.id)
    })
  })
}
