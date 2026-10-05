import { contextBridge } from 'electron'
import { api } from './api'

// renderer へは許可リスト(window.api)だけを公開する。汎用の IPC(以前の window.electron)は任意のチャンネル名の invoke・send と
// process.env の写しを通すため公開しない(設計書「セキュリティ」。それを提供していた依存は外した)
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
