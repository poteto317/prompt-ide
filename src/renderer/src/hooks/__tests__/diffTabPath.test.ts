import type { DiffTabKey } from '../useDiffTabs'
import { describe, it, expect } from 'vitest'
import { encodeDiffTabPath, isDiffTabPath, decodeDiffTabPath } from '../diffTabPath'

describe('encodeDiffTabPath / isDiffTabPath / decodeDiffTabPath', () => {
  it('staged=false でエンコードすると isDiffTabPath が true、decode で元のキーに戻る', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', kind: 'unstaged' })
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', kind: 'unstaged' })
  })

  it('staged=true でエンコードすると isDiffTabPath が true、decode で元のキーに戻る', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', kind: 'staged' })
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', kind: 'staged' })
  })

  it('実ファイルパスは isDiffTabPath が false を返す', () => {
    expect(isDiffTabPath('src/index.ts')).toBe(false)
  })

  it('パス自体に diff: を含むファイルでも誤検知しない', () => {
    expect(isDiffTabPath('src/diff:util.ts')).toBe(false)
  })

  it('過去のプレフィックス方式(文字列 "diff:staged:"/"diff:unstaged:") と偶然一致する実ファイルパスも誤検知しない', () => {
    // ':' はPOSIXで正当なファイル名文字のため、これで始まる実ファイルパスは
    // 理論上あり得る。文字列プレフィックスだけの判定だとこれを diff タブと
    // 誤認してしまうため、実ファイルパスには絶対に出現しない制御文字(NUL)を
    // マーカーに使い、原理的に衝突しないようにしている
    expect(isDiffTabPath('diff:staged:secret.ts')).toBe(false)
    expect(isDiffTabPath('diff:unstaged:secret.ts')).toBe(false)
  })

  it('往復変換で元のキーと一致する（staged/unstaged 両方）', () => {
    const unstagedKey: DiffTabKey = { path: 'a/b/c.ts', kind: 'unstaged' }
    const stagedKey: DiffTabKey = { path: 'a/b/c.ts', kind: 'staged' }
    expect(decodeDiffTabPath(encodeDiffTabPath(unstagedKey))).toEqual(unstagedKey)
    expect(decodeDiffTabPath(encodeDiffTabPath(stagedKey))).toEqual(stagedKey)
  })
})

describe('エージェントの変更の diff タブ', () => {
  it('kind: agent も往復変換で元のキーに戻り、他の種類と別の擬似パスになる', () => {
    const agentKey: DiffTabKey = { path: 'a/b/c.ts', kind: 'agent' }
    const encoded = encodeDiffTabPath(agentKey)
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual(agentKey)
    expect(encoded).not.toBe(encodeDiffTabPath({ path: 'a/b/c.ts', kind: 'unstaged' }))
  })
})
