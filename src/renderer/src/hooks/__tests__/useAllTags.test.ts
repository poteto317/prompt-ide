import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useAllTags } from '../useAllTags'
import type { Prompt } from '../../types'

const makePrompt = (overrides: Partial<Prompt> = {}): Prompt => ({
  id: 'id-1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000,
  ...overrides,
})

describe('useAllTags', () => {
  describe('タグなし', () => {
    it('プロンプトが空配列のとき空配列を返す', () => {
      const { result } = renderHook(() => useAllTags([]))
      expect(result.current).toEqual([])
    })

    it('全プロンプトにタグがないとき空配列を返す', () => {
      const prompts = [makePrompt({ id: '1' }), makePrompt({ id: '2' })]
      const { result } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual([])
    })

    it('tags が空配列のプロンプトは集計に影響しない', () => {
      const prompts = [makePrompt({ tags: [] })]
      const { result } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual([])
    })
  })

  describe('タグあり', () => {
    it('単一プロンプトのタグをソート済みで返す', () => {
      const prompts = [makePrompt({ tags: ['Vue', 'React', 'TypeScript'] })]
      const { result } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual(['React', 'TypeScript', 'Vue'])
    })

    it('複数プロンプトのタグをマージしてソート済みで返す', () => {
      const prompts = [
        makePrompt({ id: '1', tags: ['React'] }),
        makePrompt({ id: '2', tags: ['Vue', 'TypeScript'] }),
      ]
      const { result } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual(['React', 'TypeScript', 'Vue'])
    })

    it('複数プロンプトにまたがる重複タグは1つにまとめる', () => {
      const prompts = [
        makePrompt({ id: '1', tags: ['React', 'TypeScript'] }),
        makePrompt({ id: '2', tags: ['React', 'Vue'] }),
      ]
      const { result } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual(['React', 'TypeScript', 'Vue'])
    })

    it('タグありとなしが混在するとき、タグありのみ集計する', () => {
      const prompts = [
        makePrompt({ id: '1', tags: ['React'] }),
        makePrompt({ id: '2' }),
        makePrompt({ id: '3', tags: ['Vue'] }),
      ]
      const { result } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual(['React', 'Vue'])
    })
  })

  describe('プロンプト更新への追従', () => {
    it('prompts が変化すると allTags も再計算される', () => {
      let prompts = [makePrompt({ id: '1', tags: ['React'] })]
      const { result, rerender } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual(['React'])

      prompts = [...prompts, makePrompt({ id: '2', tags: ['Vue'] })]
      rerender()
      expect(result.current).toEqual(['React', 'Vue'])
    })

    it('タグを持つプロンプトが削除されるとそのタグが消える', () => {
      let prompts = [
        makePrompt({ id: '1', tags: ['React'] }),
        makePrompt({ id: '2', tags: ['Vue'] }),
      ]
      const { result, rerender } = renderHook(() => useAllTags(prompts))
      expect(result.current).toEqual(['React', 'Vue'])

      prompts = [makePrompt({ id: '2', tags: ['Vue'] })]
      rerender()
      expect(result.current).toEqual(['Vue'])
    })

    it('同一 prompts 参照では結果参照が安定する', () => {
      const prompts = [makePrompt({ tags: ['React'] })]
      const { result, rerender } = renderHook(() => useAllTags(prompts))
      const first = result.current
      rerender()
      expect(result.current).toBe(first)
    })
  })
})
