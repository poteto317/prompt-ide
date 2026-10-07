import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../gitApply')

import { discardHunkPatch, listPatchPaths } from '../gitApply'
import { PATCH_MISMATCH_MESSAGE } from '../gitHunkPatch'
import { verifyHunkPatch } from '../gitHunkPatchVerifier'

// 逆適用するパッチの検査(「変更」セクションのハンクの取り消しと、エージェントの変更のハンクの両方が使う)。
// 構造の許可リストの網羅は gitHunkPatch.test.ts、取り消しの流れでの拒否は gitDiscardService.test.ts の discardHunk で見る

const PATCH = [
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  ''
].join('\n')
const WITH_MODE = PATCH.replace('index', 'old mode 100644\nnew mode 100755\nindex')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listPatchPaths).mockResolvedValue(['f.txt'])
})

describe('verifyHunkPatch', () => {
  it('モード変更の行を取り除いたパッチを返し、順・逆の両方で対象を確かめる。逆適用はしない', async () => {
    await expect(verifyHunkPatch('/project', 'f.txt', WITH_MODE)).resolves.toBe(PATCH)
    expect(listPatchPaths).toHaveBeenCalledTimes(2)
    expect(listPatchPaths).toHaveBeenCalledWith('/project', PATCH, { reverse: false })
    expect(listPatchPaths).toHaveBeenCalledWith('/project', PATCH, { reverse: true })
    expect(discardHunkPatch).not.toHaveBeenCalled()
  })

  it('モード変更の行が無ければ、パッチをそのまま返す', async () => {
    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).resolves.toBe(PATCH)
  })

  it.each([
    ['別のファイル', ['other.txt']],
    ['複数のファイル', ['f.txt', 'g.txt']],
    ['対象なし', []]
  ])('git apply の解釈の対象が %s なら拒否する', async (_name, targets) => {
    vi.mocked(listPatchPaths).mockResolvedValue(targets)
    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).rejects.toThrow(
      PATCH_MISMATCH_MESSAGE
    )
  })

  it('パッチを解釈できない(listPatchPaths が失敗する)ときも同じエラーに変換する', async () => {
    vi.mocked(listPatchPaths).mockRejectedValue(new Error('git apply failed'))
    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).rejects.toThrow(
      PATCH_MISMATCH_MESSAGE
    )
  })

  // --numstat は順方向の新パスしか見ないため、逆方向だけが別のファイルを指すパッチ(a/b 不一致)を見逃しうる(台帳 Task 2)
  it('逆方向だけが別のパスを返すときも拒否する', async () => {
    vi.mocked(listPatchPaths).mockImplementation(async (_folder, _patch, options) =>
      options?.reverse === true ? ['other.txt'] : ['f.txt']
    )
    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).rejects.toThrow(
      PATCH_MISMATCH_MESSAGE
    )
    expect(listPatchPaths).toHaveBeenCalledWith('/project', PATCH, { reverse: true })
  })

  it('順方向だけが別のパスを返すときは、逆方向を問い合わせずに拒否する', async () => {
    vi.mocked(listPatchPaths).mockImplementation(async (_folder, _patch, options) =>
      options?.reverse === true ? ['f.txt'] : ['other.txt']
    )
    await expect(verifyHunkPatch('/project', 'f.txt', PATCH)).rejects.toThrow(
      PATCH_MISMATCH_MESSAGE
    )
    expect(listPatchPaths).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['rename を含む', PATCH.replace('index', 'rename from old.txt\nindex')],
    ['ヘッダのパスが別のファイル', PATCH.replaceAll('f.txt', 'g.txt')]
  ])('構造の検証に落ちる(%s)なら、git apply を呼ばずに拒否する', async (_name, patch) => {
    await expect(verifyHunkPatch('/project', 'f.txt', patch)).rejects.toThrow(
      PATCH_MISMATCH_MESSAGE
    )
    expect(listPatchPaths).not.toHaveBeenCalled()
  })
})
