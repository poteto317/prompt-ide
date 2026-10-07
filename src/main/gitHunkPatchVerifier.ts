import { listPatchPaths } from './gitApply'
import {
  assertHunkPatchTargets,
  stripModeChangeLines,
  PATCH_MISMATCH_MESSAGE
} from './gitHunkPatch'

// 逆適用するパッチの検査。gitHunkPatch.ts は文字列だけを扱う純粋なモジュールなので、git apply を呼ぶ検証はこちらに置く。
// 「変更」セクションのハンクの取り消し(gitDiscardService)と、エージェントの変更のハンク(agentChangesRevert)の両方が使う

// IPC の境界で届いた任意のパッチが、対象以外のファイルを書き換えないよう、許可リストで構造を
// 検証し(rename / copy / 新規作成 / a と b の不一致などを拒否)、さらに git apply の解釈でも順方向・逆方向の両方で対象が
// filePath 1 件だけであることを確かめる。chmod を伴う変更の old mode / new mode は取り除いた(内容だけが戻り、モードは残る)
// パッチを返す。git apply --numstat は index を読まないため、記録のインデックスで問い合わせる側も同じ検査を使える
export async function verifyHunkPatch(
  folderPath: string,
  filePath: string,
  patch: string
): Promise<string> {
  assertHunkPatchTargets(patch, filePath)
  const contentPatch = stripModeChangeLines(patch)
  for (const reverse of [false, true]) {
    const targets = await listPatchPaths(folderPath, contentPatch, { reverse }).catch(() => null)
    if (targets === null || targets.length !== 1 || targets[0] !== filePath) {
      throw new Error(PATCH_MISMATCH_MESSAGE)
    }
  }
  return contentPatch
}
