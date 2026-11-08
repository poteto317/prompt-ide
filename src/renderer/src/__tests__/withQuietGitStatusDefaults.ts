// useAppState のテストで useGitStatus をモックするときの補助(設計書 2026-11-08「自動の取り直し」)。
// 静かな取り直しの 2 つの関数に既定を足し、テストごとの mockReturnValue に書かなくてよいようにする(モックが返した値が優先)。
// vi.mock('../useGitStatus') の factory から使う

/** モックの useGitStatus を包み、refreshGitStatusQuietly(受け入れる)と wasGitStatusSetQuietly(偽)の既定を足す */
export function withQuietGitStatusDefaults(
  useGitStatus: (...args: never[]) => object
): (...args: unknown[]) => unknown {
  return (...args) => ({
    refreshGitStatusQuietly: async (): Promise<boolean> => true,
    wasGitStatusSetQuietly: (): boolean => false,
    ...(Reflect.apply(useGitStatus, undefined, args) as object)
  })
}
