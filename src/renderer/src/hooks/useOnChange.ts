import { useEffect, useRef } from 'react'

// useGitStatus.ts(フォルダ切替時に前フォルダの gitStatus をクリア)・
// useAppState.ts(フォルダ切替時に前フォルダの diff タブを全て閉じる)・
// App.tsx(フォルダ切替時に前フォルダの gitignoreError をクリア)が、
// 「前回の値を ref で保持し、実際に変化した場合のみ処理する」という同じ
// パターンを個別に実装していた。片方だけ判定基準(===比較)を変えると
// ずれるため、1箇所にまとめる。初回マウントは値の「変化」ではないため
// onChange を呼ばない(呼ぶと、マウント直後にも毎回クリア処理が走ってしまう)
export function useOnChange<T>(value: T, onChange: () => void): void {
  const previousRef = useRef(value)
  useEffect(() => {
    if (previousRef.current === value) return
    previousRef.current = value
    onChange()
    // onChange は呼び出し元で毎レンダー新しい関数として渡されることが多く、
    // 依存配列に含めると value が変わっていなくても再実行されてしまう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
}
