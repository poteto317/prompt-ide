import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { usePromptFilter } from '../usePromptFilter'
import type { Prompt } from '../../types'

const makePrompt = (overrides: Partial<Prompt> = {}): Prompt => ({
  id: 'id-1',
  title: 'テストタイトル',
  content: 'テストコンテンツ',
  createdAt: 1000,
  ...overrides,
})

const PROMPTS: Prompt[] = [
  makePrompt({ id: '1', title: 'リファクタリング計画', content: 'コードを整理する' }),
  makePrompt({ id: '2', title: 'バグ修正手順', content: 'エラーを再現して修正する' }),
  makePrompt({ id: '3', title: 'コードレビュー', content: 'プルリクエストを確認する' }),
]

describe('usePromptFilter', () => {
  describe('初期状態', () => {
    it('query が空のとき全件返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      expect(result.current.filteredPrompts).toEqual(PROMPTS)
    })

    it('query の初期値は空文字', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      expect(result.current.query).toBe('')
    })

    it('query と selectedTags が両方空のとき prompts と同一参照を返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      expect(result.current.filteredPrompts).toBe(PROMPTS)
    })
  })

  describe('title でのフィルタ', () => {
    it('title に部分一致するプロンプトだけを返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('リファクタリング'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('1')
    })

    it('複数の title に一致する場合は全て返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('コード'))
      expect(result.current.filteredPrompts).toHaveLength(2)
      const ids = result.current.filteredPrompts.map((p) => p.id)
      expect(ids).toContain('1')
      expect(ids).toContain('3')
    })
  })

  describe('content でのフィルタ', () => {
    it('content に部分一致するプロンプトだけを返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('エラー'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('2')
    })

    it('title と content の両方にヒットする場合も重複なく返す', () => {
      const prompts: Prompt[] = [
        makePrompt({ id: '1', title: '検索ワード', content: '検索ワードの説明' }),
        makePrompt({ id: '2', title: '別タイトル', content: '別コンテンツ' }),
      ]
      const { result } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('検索ワード'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('1')
    })
  })

  describe('大文字小文字の扱い', () => {
    it('英字は大文字小文字を区別しない', () => {
      const prompts: Prompt[] = [
        makePrompt({ id: '1', title: 'Hello World', content: '' }),
        makePrompt({ id: '2', title: 'Other', content: '' }),
      ]
      const { result } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('hello'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('1')
    })

    it('大文字クエリでも一致する', () => {
      const prompts: Prompt[] = [
        makePrompt({ id: '1', title: 'hello world', content: '' }),
      ]
      const { result } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('HELLO'))
      expect(result.current.filteredPrompts).toHaveLength(1)
    })
  })

  describe('空白処理', () => {
    it('query が空白のみのとき全件返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('   '))
      expect(result.current.filteredPrompts).toEqual(PROMPTS)
    })

    it('query の前後スペースを除去してマッチする', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('  リファクタリング  '))
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('1')
    })
  })

  describe('一致なし', () => {
    it('どのプロンプトにも一致しないとき空配列を返す', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('存在しないキーワード'))
      expect(result.current.filteredPrompts).toHaveLength(0)
    })
  })

  describe('動的な prompts 更新', () => {
    it('prompts が変わると filteredPrompts も再計算される', () => {
      let prompts = PROMPTS
      const { result, rerender } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('新規'))
      expect(result.current.filteredPrompts).toHaveLength(0)
      prompts = [...PROMPTS, makePrompt({ id: '4', title: '新規プロンプト', content: '' })]
      rerender()
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('4')
    })

    it('query をクリアすると全件に戻る', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('リファクタリング'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      act(() => result.current.setQuery(''))
      expect(result.current.filteredPrompts).toEqual(PROMPTS)
    })
  })

  describe('空の prompts', () => {
    it('prompts が空のとき空配列を返す', () => {
      const { result } = renderHook(() => usePromptFilter([]))
      expect(result.current.filteredPrompts).toHaveLength(0)
    })

    it('prompts が空で query を入力しても空配列を返す', () => {
      const { result } = renderHook(() => usePromptFilter([]))
      act(() => result.current.setQuery('何か'))
      expect(result.current.filteredPrompts).toHaveLength(0)
    })
  })

  describe('prompts.length が 0 になったとき query をリセットする', () => {
    it('全件削除後に query が空文字になる', () => {
      let prompts = PROMPTS
      const { result, rerender } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('xyz'))
      expect(result.current.filteredPrompts).toHaveLength(0)
      prompts = []
      rerender()
      expect(result.current.query).toBe('')
    })

    it('query リセット後に追加した新規プロンプトが表示される', () => {
      let prompts = PROMPTS
      const { result, rerender } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('xyz'))
      prompts = []
      rerender()
      expect(result.current.query).toBe('')
      prompts = [makePrompt({ id: '99', title: '新規プロンプト', content: '' })]
      rerender()
      expect(result.current.filteredPrompts).toHaveLength(1)
      expect(result.current.filteredPrompts[0].id).toBe('99')
    })

    it('同じ件数で prompts が差し替わっても query はリセットされない', () => {
      let prompts: Prompt[] = [makePrompt({ id: 'a', title: 'AAA', content: '' })]
      const { result, rerender } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.setQuery('AAA'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      prompts = [makePrompt({ id: 'b', title: 'BBB', content: '' })]
      rerender()
      expect(result.current.query).toBe('AAA')
    })
  })

  describe('isActive が false になったとき query をリセットする', () => {
    it('isActive が true → false に変わると query が空文字になる', () => {
      let isActive = true
      const { result, rerender } = renderHook(() => usePromptFilter(PROMPTS, { isActive }))
      act(() => result.current.setQuery('リファクタリング'))
      expect(result.current.filteredPrompts).toHaveLength(1)
      isActive = false
      rerender()
      expect(result.current.query).toBe('')
    })

    it('isActive が false → true に戻っても query は空のまま', () => {
      let isActive = true
      const { result, rerender } = renderHook(() => usePromptFilter(PROMPTS, { isActive }))
      act(() => result.current.setQuery('バグ'))
      isActive = false
      rerender()
      expect(result.current.query).toBe('')
      isActive = true
      rerender()
      expect(result.current.query).toBe('')
      expect(result.current.filteredPrompts).toEqual(PROMPTS)
    })

    it('isActive が undefined のとき query をリセットしない', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS))
      act(() => result.current.setQuery('リファクタリング'))
      expect(result.current.query).toBe('リファクタリング')
    })

    it('isActive が初回から false でも query をリセットしない（初回マウント保護）', () => {
      const { result } = renderHook(() => usePromptFilter(PROMPTS, { isActive: false }))
      expect(result.current.query).toBe('')
      act(() => result.current.setQuery('リファクタリング'))
      expect(result.current.query).toBe('リファクタリング')
    })

    it('isActive が undefined から false に変わっても query をリセットしない', () => {
      // prevIsActiveRef が undefined で初期化されるため wasActive=undefined(falsy) → guard 非発火
      // 旧コード(isActive===false で無条件 reset)との差分を検証する回帰テスト
      let options: { isActive?: boolean } = {}
      const { result, rerender } = renderHook(() => usePromptFilter(PROMPTS, options))
      act(() => result.current.setQuery('リファクタリング'))
      options = { isActive: false }
      rerender()
      expect(result.current.query).toBe('リファクタリング')
    })
  })

  describe('タグフィルター', () => {
    const taggedA: Prompt = makePrompt({ id: 'a', title: 'A', tags: ['React', 'TypeScript'] })
    const taggedB: Prompt = makePrompt({ id: 'b', title: 'B', tags: ['Vue'] })
    const noTag: Prompt = makePrompt({ id: 'c', title: 'C' })

    it('selectedTags の初期値は空配列', () => {
      const { result } = renderHook(() => usePromptFilter([taggedA]))
      expect(result.current.selectedTags).toEqual([])
    })

    it('toggleTag でタグを選択するとそのタグを持つプロンプトだけ返す', () => {
      const { result } = renderHook(() => usePromptFilter([taggedA, taggedB, noTag]))
      act(() => result.current.toggleTag('React'))
      expect(result.current.filteredPrompts).toEqual([taggedA])
    })

    it('複数タグを選択すると全てのタグを持つプロンプトだけ返す（AND 条件）', () => {
      const bothTags: Prompt = makePrompt({ id: 'd', tags: ['React', 'TypeScript'] })
      const onlyReact: Prompt = makePrompt({ id: 'e', tags: ['React'] })
      const { result } = renderHook(() => usePromptFilter([bothTags, onlyReact]))
      act(() => result.current.toggleTag('React'))
      act(() => result.current.toggleTag('TypeScript'))
      expect(result.current.filteredPrompts).toEqual([bothTags])
    })

    it('同じタグをもう一度 toggleTag すると選択解除される', () => {
      const { result } = renderHook(() => usePromptFilter([taggedA, noTag]))
      act(() => result.current.toggleTag('React'))
      expect(result.current.filteredPrompts).toEqual([taggedA])
      act(() => result.current.toggleTag('React'))
      expect(result.current.filteredPrompts).toEqual([taggedA, noTag])
    })

    it('テキスト検索とタグフィルターの AND 条件が機能する', () => {
      const { result } = renderHook(() => usePromptFilter([taggedA, taggedB]))
      act(() => result.current.toggleTag('React'))
      act(() => result.current.setQuery('A'))
      expect(result.current.filteredPrompts).toEqual([taggedA])
    })

    it('prompts が空になると selectedTags がリセットされる', () => {
      let prompts: Prompt[] = [taggedA]
      const { result, rerender } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.toggleTag('React'))
      expect(result.current.selectedTags).toEqual(['React'])
      prompts = []
      rerender()
      expect(result.current.selectedTags).toEqual([])
    })

    it('isActive が true → false に変わると selectedTags がリセットされる', () => {
      let isActive = true
      const { result, rerender } = renderHook(() => usePromptFilter([taggedA], { isActive }))
      act(() => result.current.toggleTag('React'))
      expect(result.current.selectedTags).toEqual(['React'])
      isActive = false
      rerender()
      expect(result.current.selectedTags).toEqual([])
    })

    it('タグ解除後にフィルターが全解除されると prompts と同一参照を返す', () => {
      const prompts = [taggedA, taggedB, noTag]
      const { result } = renderHook(() => usePromptFilter(prompts))
      act(() => result.current.toggleTag('React'))
      expect(result.current.filteredPrompts).not.toBe(prompts)
      act(() => result.current.toggleTag('React'))
      expect(result.current.filteredPrompts).toBe(prompts)
    })
  })
})
