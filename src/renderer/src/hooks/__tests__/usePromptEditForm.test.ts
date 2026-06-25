import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../types'
import { usePromptEditForm } from '../usePromptEditForm'

const basePrompt: Prompt = {
  id: 'p1',
  title: '元タイトル',
  content: '元コンテンツ',
  createdAt: 1000000
}

function changeInput(value: string): React.ChangeEvent<HTMLInputElement> {
  return { target: { value } } as React.ChangeEvent<HTMLInputElement>
}

function changeTextarea(value: string): React.ChangeEvent<HTMLTextAreaElement> {
  return { target: { value } } as React.ChangeEvent<HTMLTextAreaElement>
}

describe('usePromptEditForm', () => {
  it('初期値が対象 prompt から設定される', () => {
    const { result } = renderHook(() => usePromptEditForm(basePrompt, vi.fn()))
    expect(result.current.title).toBe('元タイトル')
    expect(result.current.content).toBe('元コンテンツ')
    expect(result.current.isSaveDisabled).toBe(false)
  })

  it('handleTitleChange / handleContentChange で値が更新される', () => {
    const { result } = renderHook(() => usePromptEditForm(basePrompt, vi.fn()))
    act(() => result.current.handleTitleChange(changeInput('新タイトル')))
    act(() => result.current.handleContentChange(changeTextarea('新コンテンツ')))
    expect(result.current.title).toBe('新タイトル')
    expect(result.current.content).toBe('新コンテンツ')
  })

  it('タイトルが空のとき isSaveDisabled は true', () => {
    const { result } = renderHook(() => usePromptEditForm(basePrompt, vi.fn()))
    act(() => result.current.handleTitleChange(changeInput('')))
    expect(result.current.isSaveDisabled).toBe(true)
  })

  it('内容が空白のみのとき isSaveDisabled は true', () => {
    const { result } = renderHook(() => usePromptEditForm(basePrompt, vi.fn()))
    act(() => result.current.handleContentChange(changeTextarea('   ')))
    expect(result.current.isSaveDisabled).toBe(true)
  })

  it('handleSave で onSubmit が trim 済みの値で呼ばれる', () => {
    const onSubmit = vi.fn()
    const { result } = renderHook(() => usePromptEditForm(basePrompt, onSubmit))
    act(() => result.current.handleTitleChange(changeInput('  T  ')))
    act(() => result.current.handleContentChange(changeTextarea('  C  ')))
    act(() => result.current.handleSave())
    expect(onSubmit).toHaveBeenCalledWith('T', 'C', [])
  })

  it('isSaveDisabled のとき handleSave で onSubmit は呼ばれない', () => {
    const onSubmit = vi.fn()
    const { result } = renderHook(() => usePromptEditForm(basePrompt, onSubmit))
    act(() => result.current.handleTitleChange(changeInput('')))
    act(() => result.current.handleSave())
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
