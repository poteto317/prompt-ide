# ステータスバーのブランチ表示と切り替え 実装プラン

> サブエージェント駆動開発で進める。タスクごとに新しいサブエージェントで実装し、タスクごとにレビューを挟み、最後に全体をレビューする。コミットはしない。

**目的:** 左下のブランチ名を実際のブランチにし、押すと VS Code と同じ形の一覧で切り替えられるようにする。履歴のブランチ名のバッジを消す。

**設計書:** `docs/superpowers/specs/2026-10-30-status-bar-branch-picker-design.md`

**気をつける知見:** L-001(未実行を成功扱いしない)、L-008(切り替えは既存の `checkoutBranch` を通す)、L-408(キーリピートとダブルクリックの続き)。

**検証コマンド:** シェルの `NODE_ENV=production` で全体が落ちるため、必ず `NODE_ENV=test` を付ける。

```sh
NODE_ENV=test npx vitest run <対象>
NODE_ENV=test npm test
npm run typecheck
npx eslint <変更したファイル>
```

## タスク 1: 履歴のブランチ名のバッジを消す

**ファイル:** `src/renderer/src/components/source-control/HistorySection.tsx`、`src/renderer/src/assets/main.css`、`__tests__/HistorySection.test.tsx`、`__tests__/GitRepoView.test.tsx`

1. `HistorySection.test.tsx` の `ブランチ名・タグ名をバッジとして表示する` を `タグ名だけをバッジとして表示し、ブランチ名は表示しない` に変える。`branches` に `main`・`dev` を渡したまま、`queryByText('main')`・`queryByText('dev')` が null、`getByText('v1.0.0')` があることを確かめる。タグが 0 件のとき `.history-section__badges` が無いテストを足す。
2. テストが落ちることを確認する。
3. 実装する。`branches` prop は `CreateTagDialog` のために残す。

   ```tsx
   {tags.length > 0 && (
     <div className="history-section__badges">
       {tags.map((tag) => (
         <span key={tag} className="history-section__badge history-section__badge--tag">
           {tag}
         </span>
       ))}
     </div>
   )}
   ```

4. `main.css` から `.history-section__badge--branch-current` と `.history-section__badge--branch` を消し、直前のコメントを「タグは灰色のままだと目立たないためオレンジ系にする」旨に直す。
5. `GitRepoView.test.tsx` の `.history-section__badge--branch-current` の検証を消す(`feat: 新機能` の検証は残す)。テスト名 `CommitSection と HistorySection に必要な props が渡る` はそのまま。
6. 対象のテストを通す。

## タスク 2: 一覧の純粋関数

**ファイル:** `src/renderer/src/lib/branchPicker.ts`(新規)、`src/renderer/src/lib/__tests__/branchPicker.test.ts`(新規)、`src/main/gitService.ts`、`src/main/__tests__/gitService.test.ts`、`src/main/__tests__/gitService.status.integration.test.ts`、`src/shared/types/git.ts`

```ts
import type { GitBranch } from '@shared/types'

export interface BranchPickerItem {
  name: string
  isCurrent: boolean
}

// 一覧の候補。現在のブランチは gitStatus 由来の currentBranch だけで決める(branches は履歴の再取得でしか
// 更新されず、gitStatus より遅れることがある)。null は detached。同じ理由で GitBranch.current は使わず、
// 実在しない疑似項目は取得元の getBranches が付けた isDetachedHead で除く
export function buildBranchPickerItems(
  branches: readonly GitBranch[],
  currentBranch: string | null,
  query: string
): BranchPickerItem[]

// 開いたときの選択。現在のブランチの次の候補、無ければ先頭、候補が 0 件なら null
export function initialBranchPickerSelection(items: readonly BranchPickerItem[]): string | null

// 選択中の名前を今の候補に合わせる。候補から消えていたら先頭、候補が 0 件なら null
export function resolveBranchPickerSelection(
  items: readonly BranchPickerItem[],
  selected: string | null
): string | null

// 選択を delta(1 / -1)だけ循環して動かす
export function moveBranchPickerSelection(
  items: readonly BranchPickerItem[],
  selected: string | null,
  delta: 1 | -1
): string | null
```

規則:

- `getBranches` は `getCurrentBranchRef(git)` も取得し、`ref === null && name === summary.current` の項目に `isDetachedHead: true` を付ける。`summary.detached` は rebase 中・bisect 中に false になるため使わない。印が無い項目には欄を付けない。疑似項目は返し続け、`BranchSwitcher` の表示は変えない。
- `buildBranchPickerItems` は `currentBranch` の値によらず `branch.isDetachedHead` の項目を除く。`branch.current` は参照しない。
- `currentBranch` が非 null のときは `currentBranch` と同名を除いた残りの前に `{ name: currentBranch, isCurrent: true }` を置く(`branches` に無くても足す。コミットの無いリポジトリの場合)。
- 絞り込みは `name.toLowerCase().includes(query.toLowerCase())`。現在のブランチにも適用する。`query` の前後の空白は `trim()` する。

テスト(先に書いて落ちることを確認する): 並び、絞り込み、大文字小文字、0 件、`GitBranch.current` が別のブランチを指すずれ、疑似項目の除外(`currentBranch` が null のときと、`branches` が古く非 null のとき)、`currentBranch` が null のときに古い `current: true` の実在のブランチが残ること、`branches` が空でも現在のブランチが候補になること、初期選択の 3 通り、`resolveBranchPickerSelection` の 3 通り、`moveBranchPickerSelection` の循環。`getBranches` は実 git で、detached(SHA・`refs/heads/main` の形)、rebase 中、bisect 中に疑似項目だけに印が付くこと、ブランチ上では欄が付かないこと。

## タスク 3: `BranchQuickPick`

**ファイル:** `src/renderer/src/components/source-control/BranchQuickPick.tsx`(新規)、`__tests__/BranchQuickPick.test.tsx`(新規)、`src/renderer/src/lib/isScrollbarMouseDown.ts`(新規)、`src/renderer/src/components/quick-open/QuickOpenDialog.tsx`。`QuickOpenDialog.test.tsx` も実行する。

```ts
interface Props {
  branches: GitBranch[]
  currentBranch: string | null
  /** 押せない状態(ブランチ操作の実行中・他の操作中)。確定を無視し、案内を出す */
  isDisabled: boolean
  onSelect: (branchName: string) => void
  onClose: () => void
}
```

- 親が開いている間だけマウントする。`onClose` は現在のブランチの確定、Escape、オーバーレイで呼ぶ。別のブランチの確定は `onSelect` のみを呼ぶ(閉じるのと切り替えの順序は親が決める)。
- state: `query`、`selected`(`useState(() => initialBranchPickerSelection(buildBranchPickerItems(branches, currentBranch, '')))`)。
- 描画時に `items = buildBranchPickerItems(branches, currentBranch, query)`、`activeName = resolveBranchPickerSelection(items, selected)`。
- 入力の変更: `setQuery(value)` と `setSelected(next[0]?.name ?? null)`。
- フォーカス: `useLayoutEffect` で入力欄へ。戻すのは親(`useDialogFocusReturn`)の役割なので、ここでは戻さない。
- document の capture の keydown で Tab を入力欄に留める。`isComposing` は横取りしない(`QuickOpenDialog` と同じ)。
- document の keydown で Escape を受ける。`isComposing` なら無視。`onClose` は描画ごとに参照が変わるため、`src/renderer/src/hooks/useLatestRef.ts` の `useLatestRef` を使う。
- 入力欄の `onKeyDown`: `isComposing` は無視、↑↓ は `moveBranchPickerSelection`、Enter は `preventDefault` し、`e.repeat` でなければ押し始めの印を立てる。確定は `onKeyUp` で印があるときに `confirm(activeName)` を呼ぶ。印は IME の変換中の keydown と `onBlur` でも消す。
- `confirm(name)`: `name === null || isDisabled` なら何もしない。`name === currentBranch` なら `onClose()`、それ以外は `onSelect(name)`。
- 選択の項目は `scrollIntoView({ block: 'nearest' })`。
- 項目の `onMouseDown` などのフォーカス保持、オーバーレイの `pressedOnOverlayRef` は `QuickOpenDialog` と同じ形にする。オーバーレイの `onClick` は `e.detail > 1` なら無視する。オーバーレイの `onMouseUp` で入力欄へ戻す。`e.target === inputRef.current` の場合だけ既定動作を止めない。
- スクロールバー判定 `isScrollbarMouseDown` は `QuickOpenDialog` から `src/renderer/src/lib/isScrollbarMouseDown.ts` へ切り出して共有する(`QuickOpenDialog` の挙動は変えない)。
- ARIA: `role="dialog"`、`aria-modal="true"`、`aria-label="ブランチを切り替え"`。入力欄 `role="combobox"`、`aria-label="ブランチ名で絞り込む"`、`aria-expanded`、`aria-controls="branch-picker-listbox"`、`aria-autocomplete="list"`、候補があれば `aria-activedescendant`。プレースホルダは `切り替えるブランチを選択`。一覧 `role="listbox"`、`aria-label="ブランチ"`、項目 `role="option"`、`aria-selected`、`id="branch-picker-option-<添字>"`、`key={item.name}`。
- クラス: `quick-open__overlay`、`quick-open`、`quick-open__input`、`quick-open__list`、`quick-open__item`、`quick-open__item--active`、`quick-open__name`、`quick-open__directory`(`現在` の印)、`quick-open__empty`。案内は `quick-open__empty` を `role="status"` で出す。
- 候補が 0 件: `query.trim() !== ''` なら `一致するブランチがありません`、それ以外は `ブランチがありません`。

テストは設計書の「テスト」の `BranchQuickPick` の項目すべて。IME は `fireEvent.keyDown(input, { key: 'Enter', isComposing: true })`、キーリピートは `repeat: true`、オーバーレイは `QuickOpenDialog.test.tsx` と同じく先に `fireEvent.mouseDown(overlay)` を送ってから `fireEvent.click(overlay, { detail })` を送る(mouseDown が無いと `pressedOnOverlayRef` が false のままで、判定が無くても通ってしまう)。`detail: 2` のテストは続けて `fireEvent.mouseUp(overlay)` を送り、入力欄へのフォーカスの戻りも確かめる。`act(...).then(...)` の形は使わない。

## タスク 4: `StatusBarBranch` と `StatusBar`

**ファイル:** `src/renderer/src/components/StatusBarBranch.tsx`(新規)、`src/renderer/src/components/StatusBar.tsx`、`src/renderer/src/assets/main.css`、`src/renderer/src/components/__tests__/StatusBarBranch.test.tsx`(新規)、`__tests__/StatusBar.test.tsx`

```ts
export interface StatusBarBranchState {
  /** detached のときは null */
  currentBranch: string | null
  branches: GitBranch[]
  pendingBranchOperation: BranchOperationKind | null
  /** 他の操作中(GitRepoView の isBlockedByOtherOperation と同じ判定) */
  isBlocked: boolean
  error: Error | null
  onCheckoutBranch: (branchName: string) => Promise<void>
}
```

```tsx
export default function StatusBarBranch({ state }: Props): React.JSX.Element {
  const { currentBranch, branches, pendingBranchOperation, isBlocked, error, onCheckoutBranch } = state
  const triggerRef = useRef<HTMLButtonElement>(null)
  const isDisabled = pendingBranchOperation !== null || isBlocked
  const dialog = useDialogFocusReturn({ isRunning: isDisabled, openerRef: triggerRef })
  const label = getBranchTriggerLabel({ pendingBranchOperation, isBlocked, currentBranch })
  const handleSelect = (branchName: string): void => {
    dialog.close()
    void onCheckoutBranch(branchName)
  }
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="status-bar__item status-bar__branch"
        disabled={isDisabled}
        aria-haspopup="dialog"
        aria-expanded={dialog.isOpen}
        aria-label={label.ariaLabel}
        onClick={dialog.open}
        // Enter を押し続けて一覧を確定し、ここへ戻ったときにリピートで開き直さない(Space は keyup で押すので対象外)
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.repeat) e.preventDefault()
        }}
      >
        <BranchIcon />
        <span>{label.text}</span>
      </button>
      {error !== null && (
        <span className="status-bar__item status-bar__branch-error" role="alert" title={error.message}>
          {error.message}
        </span>
      )}
      {dialog.isOpen && (
        <BranchQuickPick
          branches={branches}
          currentBranch={currentBranch}
          isDisabled={isDisabled}
          onSelect={handleSelect}
          onClose={dialog.close}
        />
      )}
    </>
  )
}
```

`StatusBar.tsx` は `branch: StatusBarBranchState | null` を必須で受け、固定の `<div className="status-bar__item"><BranchIcon /><span>main</span></div>` を `{branch !== null && <StatusBarBranch state={branch} />}` に置き換える。`BranchIcon` の import を消す。

CSS(`.status-bar__agent` の近く。hover・focus-visible は同じ見た目に揃える):

```css
.status-bar__branch {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

/* 明るくすると #007acc と白の文字の比が 4.5:1 を割るため、.status-bar__agent と同じく暗くする */
.status-bar__branch:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.15);
}

.status-bar__branch:focus-visible {
  outline: 1px solid #ffffff;
  outline-offset: -2px;
}

.status-bar__branch:disabled {
  cursor: default;
}

.status-bar__branch-error {
  display: block;
  min-width: 0;
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #a1260d;
}
```

テスト: `StatusBarBranch` は設計書の項目すべて。`pendingBranchOperation` を `checkout` にして `rerender` し、null に戻した後に `document.activeElement` がボタンになることを確かめる(`dialog.close()` のあと body へフォーカスを移してから解く)。`StatusBar.test.tsx` は、ブランチの表示に関係しないケースに `branch={null}` を渡す。既存の `ブランチの表示の後ろ(左側)に置く` には実物の値(`currentBranch: 'main'` など)を渡す(`branch={null}` だと空振りで通る)。`ブランチ名 "main" が表示される` は `branch` ありのテストへ置き換え、`branch={null}` で `main` が出ないことを足す。

## タスク 5: 失敗の消去と App の配線

**ファイル:** `src/renderer/src/hooks/useGitBranchOperations.ts`、`src/renderer/src/hooks/useAppState.ts`、`src/renderer/src/App.tsx`、対応するテスト

1. `useGitBranchOperations` のテストに、失敗を `clearBranchOperationError()` で消せること、コンフリクトの通知も消せることを足す。`useAppState.test.ts` に「フォルダが変わると `branchOperationError` が null になる」を足す。`App.*.test.tsx` に、リポジトリならブランチ名が出る、`detached` なら `(no branch)`、`isRepo: false` なら出ない、を足す。どれも実装の前に落ちることを確認する。
2. 実装する。

   ```ts
   const clearBranchOperationError = useCallback((): void => {
     // 控えも消す。残すと、消した通知を指したまま次の通知まで保持する
     conflictNoticeRef.current = null
     setBranchOperationError(null)
   }, [])
   ```

   戻り値と型に足す。

3. `useAppState` の `useOnChange(fileSystem.folderPath, ...)` の近くに、`useOnChange(fileSystem.folderPath, gitBranchOperations.clearBranchOperationError)` を足す(`gitBranchOperations` の定義より後)。戻り値は `Omit` の型に合わせ、公開しない。
4. `App.tsx` で組み立てる。

   ```tsx
   // isGitOperationDisabled は型を絞り込まないため、ここでは直接判定する
   const statusBarBranch =
     gitStatus === null || !gitStatus.isRepo
       ? null
       : {
         currentBranch: gitStatus.detached ? null : gitStatus.branch,
         branches,
         pendingBranchOperation,
         isBlocked: stagingPaths.size > 0 || isAnyLocked(),
         error: branchOperationError,
         onCheckoutBranch: checkoutBranch
       }
   ```

   `<StatusBar agent={statusBarAgent} branch={statusBarBranch} />` へ渡す。

5. `NODE_ENV=test npm test`、`npm run typecheck`、変更したファイルの eslint を通す。

## タスク 6: ドキュメントとテスト仕様書

1. `ROADMAP.md`: `現在のブランチ名の動的表示（現在はハードコード）` を `[x]` にする。実装済みの節「ソース管理（Git 操作）」に、ステータスバーからの切り替えの項目と既知の制約(設計書の 3 件)を足す。「今後」にソース管理の第 2 段階(グラフ)・第 3 段階(パネルの配置)を足す。既存の `コミット履歴 / ログのグラフ表示` は第 2 段階の項目として扱う。
2. `docs/manual-test-spec.md`:
   - BASE-015: 左にブランチアイコンと現在のブランチ名(リポジトリのとき)、右の 3 つは固定表示。
   - GIT-070: `履歴` の下のバッジ → タグ `v1.0` がバッジで出て、ブランチ名は出ない。
   - GIT-071・GIT-072 を消す。
   - BRN-042、RMT-025、`「履歴」のバッジは、ブランチ名に続けてすべてのタグ名を並べる` の前提を実態に合わせる。
   - 新しい節 `### ステータスバーのブランチの切り替え` を `## ブランチ操作` の領域に足す。`BRN-067` から振る。内容: 動的表示、リポジトリ外で出ない、detached の `(no branch)`、押すと上部中央に一覧、現在の印、絞り込み、↑↓ と Enter、クリック、Escape、オーバーレイ、IME、切り替えの成功、未保存があるときの確認(確認に Enter のリピートが届かないこと)、失敗の表示、フォルダの切り替えで失敗が消える、ダブルクリックで閉じない、Enter を押し続けて開き直さない、実行中の文言と押せない状態。
3. `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、`NODE_ENV=test npx vitest run scripts` を通す。
4. Artifact の再公開は、変更が `main` に入ってから行う(別セッションが同じ Artifact を更新している可能性があり、未マージの内容を公開しないため)。実装の報告にその旨を書く。
5. `docs/developer-guide.md` にステータスバーやブランチの切り替えの説明があれば同期する。

## 最終: 全体のレビュー

全タスクの後に `git diff origin/main` 全体をレビューし、`NODE_ENV=test npm test`、`npm run typecheck`、`npx eslint`(変更したファイル)を通す。コミットはしない。
