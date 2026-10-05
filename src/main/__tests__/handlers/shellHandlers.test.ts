import { describe, it, expect, vi } from 'vitest'
import { openExternalLink, registerShellHandlers } from '../../handlers/shellHandlers'

function setup(): {
  invoke: (url: unknown) => Promise<unknown>
  openExternal: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) =>
      handlers.set(channel, listener)
  }
  const openExternal = vi.fn(async () => undefined)
  registerShellHandlers(ipcMain as never, openExternal)
  return {
    invoke: (url) => handlers.get('shell:openExternalLink')?.({}, url) as Promise<unknown>,
    openExternal
  }
}

describe('shell:openExternalLink', () => {
  it('https の URL を、正規化した href で開いて true', async () => {
    const { invoke, openExternal } = setup()
    await expect(invoke('https://example.com')).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
  })
  it('大文字のスキームは正規化して開く', async () => {
    const { invoke, openExternal } = setup()
    await expect(invoke('HTTPS://Example.com/a')).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a')
  })
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'x-custom://a',
    'data:text/html,x',
    ' https://a.com',
    'htt\nps://a.com',
    'https:example.com',
    'https://',
    '//a.com',
    1,
    null
  ])('%s は開かずに false', async (url) => {
    const { invoke, openExternal } = setup()
    await expect(invoke(url)).resolves.toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('shell:openExternalLink(開けなかったとき)', () => {
  it('OS が開けずに reject しても、例外にせず false を返す(renderer に未処理の reject を出さない)', async () => {
    const { invoke, openExternal } = setup()
    openExternal.mockRejectedValueOnce(new Error('No application found to open URL'))
    await expect(invoke('https://example.com')).resolves.toBe(false)
    expect(openExternal).toHaveBeenCalledOnce()
  })
})

describe('openExternalLink(新しいウィンドウの依頼からも使う)', () => {
  it('http・https は正規化した href で開いて true', async () => {
    const openExternal = vi.fn(async () => undefined)
    await expect(openExternalLink(openExternal, 'HTTPS://Example.com/a')).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/a')
  })
  it('ほかのスキームは開かずに false', async () => {
    const openExternal = vi.fn(async () => undefined)
    await expect(openExternalLink(openExternal, 'file:///etc/passwd')).resolves.toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })
  it('開けずに reject しても false を返す(reject しない)', async () => {
    const openExternal = vi.fn(async () => {
      throw new Error('No application found to open URL')
    })
    await expect(openExternalLink(openExternal, 'https://example.com')).resolves.toBe(false)
  })
})
