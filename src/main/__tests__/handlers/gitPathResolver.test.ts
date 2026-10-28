import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FolderAccessManager } from '../../folderAccessManager'
import {
  resolveAndAssertRelativePath,
  resolveAndAssertStatusRelativePath
} from '../../handlers/gitPathResolver'

// gitHandlers.test.ts は fs と toGitRelativePath をモックして受け口の配線を確かめる。ここでは実際のファイルシステム
// (シンボリックリンク・削除済みのパス・表記の違い)に対して、パスの解決と境界の検査の規則を直接確かめる

let tempRoot: string
let folder: string
let outside: string
let linkToFolder: string
const folderAccess = new FolderAccessManager()

function writeFile(path: string, content = 'x'): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  // 許可フォルダは dialog:openFolder と同じく realpath 済みの値を使う(macOS の /var → /private/var 等)
  tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'gitPathResolver-')))
  folder = join(tempRoot, 'repo')
  outside = join(tempRoot, 'outside')
  writeFile(join(folder, 'src', 'a.txt'))
  writeFile(join(folder, '..env'))
  writeFile(join(outside, 'secret.txt'))
  linkToFolder = join(tempRoot, 'link-repo')
  symlinkSync(folder, linkToFolder, 'dir')
})

afterEach(() => {
  removeTempPathSync(tempRoot)
})

describe('resolveAndAssertRelativePath', () => {
  it('許可フォルダ基準の相対パスを、/ 区切りのリポジトリ相対パスにして返す', async () => {
    await expect(resolveAndAssertRelativePath(folderAccess, folder, 'src/a.txt')).resolves.toBe(
      'src/a.txt'
    )
  })

  it('許可フォルダの中の絶対パスも、リポジトリ相対パスにして返す', async () => {
    await expect(
      resolveAndAssertRelativePath(folderAccess, folder, join(folder, 'src', 'a.txt'))
    ).resolves.toBe('src/a.txt')
  })

  it.each([
    ['.. で外へ出る相対パス', () => '../outside/secret.txt'],
    ['許可フォルダの外の絶対パス', () => join(outside, 'secret.txt')],
    ['空のパス(許可フォルダそのもの)', () => ''],
    ['..(許可フォルダの親)', () => '..']
  ])('%s は Access denied で拒否する', async (_label, makePath) => {
    await expect(resolveAndAssertRelativePath(folderAccess, folder, makePath())).rejects.toThrow(
      'Access denied'
    )
  })

  it('許可フォルダの外を指すシンボリックリンクを経由したパスは拒否する', async () => {
    symlinkSync(outside, join(folder, 'escape'), 'dir')
    await expect(
      resolveAndAssertRelativePath(folderAccess, folder, 'escape/secret.txt')
    ).rejects.toThrow('Access denied')
  })

  it('シンボリックリンクの祖先を経由した絶対パスは、realpath 側の表記を基準に相対パス化する', async () => {
    await expect(
      resolveAndAssertRelativePath(folderAccess, folder, join(linkToFolder, 'src', 'a.txt'))
    ).resolves.toBe('src/a.txt')
  })

  it('対象自体がシンボリックリンクなら、リンク先の実体名に化けさせずリンク名のまま返す', async () => {
    symlinkSync(join(folder, 'src', 'a.txt'), join(folder, 'link.txt'))
    await expect(resolveAndAssertRelativePath(folderAccess, folder, 'link.txt')).resolves.toBe(
      'link.txt'
    )
  })

  it('削除済みのファイルも、解決前のパスで相対パス化して続行する', async () => {
    await expect(resolveAndAssertRelativePath(folderAccess, folder, 'src/gone.txt')).resolves.toBe(
      'src/gone.txt'
    )
  })

  it('祖先ディレクトリごと削除されていても、実在する祖先まで遡って相対パス化する', async () => {
    await expect(
      resolveAndAssertRelativePath(
        folderAccess,
        folder,
        join(linkToFolder, 'gone', 'deep', 'x.txt')
      )
    ).resolves.toBe('gone/deep/x.txt')
  })
})

describe('resolveAndAssertStatusRelativePath', () => {
  it('git status の表記の相対パスをそのまま返す', async () => {
    await expect(
      resolveAndAssertStatusRelativePath(folderAccess, folder, 'src/a.txt')
    ).resolves.toBe('src/a.txt')
  })

  it.each([
    ['.. で外へ出る相対パス', () => '../outside/secret.txt'],
    ['許可フォルダの外の絶対パス', () => join(outside, 'secret.txt')],
    ['空のパス(許可フォルダそのもの)', () => ''],
    ['..(許可フォルダの親)', () => '..'],
    // 境界チェック(realpath)は通るが、相対パスが許可フォルダの外を指すので git へ渡さない
    ['シンボリックリンクの祖先を経由した絶対パス', () => join(linkToFolder, 'src', 'a.txt')]
  ])('%s は Access denied で拒否する', async (_label, makePath) => {
    await expect(
      resolveAndAssertStatusRelativePath(folderAccess, folder, makePath())
    ).rejects.toThrow('Access denied')
  })

  it("'..' で始まる名前のファイル('..env' 等)はフォルダ外とみなさずに返す", async () => {
    await expect(resolveAndAssertStatusRelativePath(folderAccess, folder, '..env')).resolves.toBe(
      '..env'
    )
  })

  it('フォルダの中のシンボリックリンクの祖先を経由したパスは、realpath で作り直さずそのまま返す', async () => {
    symlinkSync(join(folder, 'src'), join(folder, 'alias'), 'dir')
    await expect(
      resolveAndAssertStatusRelativePath(folderAccess, folder, 'alias/a.txt')
    ).resolves.toBe('alias/a.txt')
    // 比較: resolveAndAssertRelativePath は親を realpath した表記にする
    await expect(resolveAndAssertRelativePath(folderAccess, folder, 'alias/a.txt')).resolves.toBe(
      'src/a.txt'
    )
  })

  // macOS(APFS)は表記を保存しつつ正規化を区別しないため、NFC で渡したパスが NFD のディレクトリに一致する
  it.skipIf(process.platform !== 'darwin')(
    '親の realpath が NFD を返しても、NFC(status の表記)のまま返す',
    async () => {
      const nfd = 'が'.normalize('NFD')
      const nfc = 'が'.normalize('NFC')
      writeFile(join(folder, nfd, 'a.txt'))
      await expect(
        resolveAndAssertStatusRelativePath(folderAccess, folder, `${nfc}/a.txt`)
      ).resolves.toBe(`${nfc}/a.txt`)
      // 比較: resolveAndAssertRelativePath はディスク上の表記(NFD)に化ける
      await expect(
        resolveAndAssertRelativePath(folderAccess, folder, `${nfc}/a.txt`)
      ).resolves.toBe(`${nfd}/a.txt`)
    }
  )
})
