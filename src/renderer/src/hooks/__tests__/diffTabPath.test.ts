import { describe, it, expect } from 'vitest'
import { encodeDiffTabPath, isDiffTabPath, decodeDiffTabPath } from '../diffTabPath'

describe('encodeDiffTabPath / isDiffTabPath / decodeDiffTabPath', () => {
  it('staged=false でエンコードすると isDiffTabPath が true、decode で元のキーに戻る', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', staged: false })
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', staged: false })
  })

  it('staged=true でエンコードすると isDiffTabPath が true、decode で元のキーに戻る', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', staged: true })
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', staged: true })
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
    const unstagedKey = { path: 'a/b/c.ts', staged: false }
    const stagedKey = { path: 'a/b/c.ts', staged: true }
    expect(decodeDiffTabPath(encodeDiffTabPath(unstagedKey))).toEqual(unstagedKey)
    expect(decodeDiffTabPath(encodeDiffTabPath(stagedKey))).toEqual(stagedKey)
  })
})
