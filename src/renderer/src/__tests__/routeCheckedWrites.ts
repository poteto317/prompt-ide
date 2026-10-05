import { vi } from 'vitest'
import * as fileSystemApi from '../lib/fileSystemApi'

// 照合付きの保存(writeFileContentChecked)を、従来の writeFileContent のモックへ流す(vi.mock('../../lib/fileSystemApi') の
// テストで、top-level の beforeEach の最後に呼ぶ)。既存のテストは writeFileContent の呼び出し・待ち・失敗で保存を観測しているため、
// 照合は常に一致する(written)ものとして同じモックを通す。照合の不一致の振る舞いは useFileEditing.saveConflict.test.ts で確かめる
export function routeCheckedWritesToWriteFileContent(): void {
  vi.mocked(fileSystemApi.writeFileContentChecked).mockImplementation(async (path, content) => {
    await fileSystemApi.writeFileContent(path, content)
    return { kind: 'written' }
  })
}
