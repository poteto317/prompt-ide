import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePromptForm } from '../usePromptForm'

describe('usePromptForm', () => {
  it('初期状態で title と content が空・isDisabled が true', () => {
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    expect(result.current.title).toBe('')
    expect(result.current.content).toBe('')
    expect(result.current.isDisabled).toBe(true)
  })

  it('title のみ入力されているとき isDisabled が true', () => {
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    act(() => {
      result.current.handleTitleChange({ target: { value: 'My Title' } } as React.ChangeEvent<HTMLInputElement>)
    })
    expect(result.current.isDisabled).toBe(true)
  })

  it('content のみ入力されているとき isDisabled が true', () => {
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    act(() => {
      result.current.handleContentChange({ target: { value: 'My Content' } } as React.ChangeEvent<HTMLTextAreaElement>)
    })
    expect(result.current.isDisabled).toBe(true)
  })

  it('title と content 両方入力済みのとき isDisabled が false', () => {
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    act(() => {
      result.current.handleTitleChange({ target: { value: 'Title' } } as React.ChangeEvent<HTMLInputElement>)
      result.current.handleContentChange({ target: { value: 'Content' } } as React.ChangeEvent<HTMLTextAreaElement>)
    })
    expect(result.current.isDisabled).toBe(false)
  })

  it('空白のみの入力は isDisabled が true のまま', () => {
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    act(() => {
      result.current.handleTitleChange({ target: { value: '   ' } } as React.ChangeEvent<HTMLInputElement>)
      result.current.handleContentChange({ target: { value: '   ' } } as React.ChangeEvent<HTMLTextAreaElement>)
    })
    expect(result.current.isDisabled).toBe(true)
  })

  it('handleSubmit で onAdd がトリムされた値で呼ばれる', () => {
    const onAdd = vi.fn()
    const { result } = renderHook(() => usePromptForm(onAdd))
    act(() => {
      result.current.handleTitleChange({ target: { value: ' Title ' } } as React.ChangeEvent<HTMLInputElement>)
      result.current.handleContentChange({ target: { value: ' Content ' } } as React.ChangeEvent<HTMLTextAreaElement>)
    })
    act(() => {
      result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>)
    })
    expect(onAdd).toHaveBeenCalledWith('Title', 'Content')
  })

  it('handleSubmit 後に title と content がリセットされる', () => {
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    act(() => {
      result.current.handleTitleChange({ target: { value: 'Title' } } as React.ChangeEvent<HTMLInputElement>)
      result.current.handleContentChange({ target: { value: 'Content' } } as React.ChangeEvent<HTMLTextAreaElement>)
    })
    act(() => {
      result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>)
    })
    expect(result.current.title).toBe('')
    expect(result.current.content).toBe('')
  })

  it('isDisabled のとき handleSubmit が onAdd を呼ばない', () => {
    const onAdd = vi.fn()
    const { result } = renderHook(() => usePromptForm(onAdd))
    act(() => {
      result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>)
    })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('handleSubmit が preventDefault を呼ぶ', () => {
    const preventDefault = vi.fn()
    const { result } = renderHook(() => usePromptForm(vi.fn()))
    act(() => {
      result.current.handleSubmit({ preventDefault } as unknown as React.FormEvent<HTMLFormElement>)
    })
    expect(preventDefault).toHaveBeenCalled()
  })
})
