import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { CloneRegistry } from '../cloneRegistry'
import { setupCloneLifecycle } from '../cloneLifecycle'

describe('setupCloneLifecycle', () => {
  it('ウィンドウ(webContents)が閉じたら、そのウィンドウの clone だけを中止する', () => {
    const app = new EventEmitter()
    const registry = new CloneRegistry()
    setupCloneLifecycle(app as unknown as App, registry)
    const closing = Object.assign(new EventEmitter(), { id: 1 })
    const other = Object.assign(new EventEmitter(), { id: 2 })
    app.emit('web-contents-created', {}, closing)
    app.emit('web-contents-created', {}, other)
    const closingClone = registry.begin(1)
    const otherClone = registry.begin(2)
    closing.emit('destroyed')
    expect(closingClone.signal.aborted).toBe(true)
    expect(otherClone.signal.aborted).toBe(false)
  })

  it.each([
    [
      'メインフレームの別文書への遷移(リロード)では中止する',
      { isMainFrame: true, isSameDocument: false },
      true
    ],
    [
      '同じ文書内の遷移(ハッシュの変更など)では中止しない',
      { isMainFrame: true, isSameDocument: true },
      false
    ],
    ['サブフレームの遷移では中止しない', { isMainFrame: false, isSameDocument: false }, false]
  ])('%s', (_label, details, aborted) => {
    const app = new EventEmitter()
    const registry = new CloneRegistry()
    setupCloneLifecycle(app as unknown as App, registry)
    const navigating = Object.assign(new EventEmitter(), { id: 1 })
    const other = Object.assign(new EventEmitter(), { id: 2 })
    app.emit('web-contents-created', {}, navigating)
    app.emit('web-contents-created', {}, other)
    const navigatingClone = registry.begin(1)
    const otherClone = registry.begin(2)
    // Electron 39 は第 1 引数の details(Event に url・isMainFrame・isSameDocument などを足したもの)で渡す
    navigating.emit('did-start-navigation', { url: 'app://index.html', frame: null, ...details })
    expect(navigatingClone.signal.aborted).toBe(aborted)
    expect(otherClone.signal.aborted).toBe(false)
  })

  it('閉じたウィンドウの中止は registry.cancel に委ね、実行中でなくても例外を出さない', () => {
    const app = new EventEmitter()
    const registry = new CloneRegistry()
    const cancel = vi.spyOn(registry, 'cancel')
    setupCloneLifecycle(app as unknown as App, registry)
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    expect(() => webContents.emit('destroyed')).not.toThrow()
    expect(cancel).toHaveBeenCalledWith(3)
  })
})
