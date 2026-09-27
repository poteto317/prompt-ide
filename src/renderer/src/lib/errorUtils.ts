// catch(err) の err は unknown 型のため、Error 以外(文字列・オブジェクト等)を
// throw されるケースを含めて、常に Error インスタンスへ正規化する
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}
