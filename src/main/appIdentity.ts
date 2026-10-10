/**
 * Windows の AppUserModelID。electron-builder.yml の appId と同じ値にする(Windows のトースト通知は、ショートカットの
 * AppUserModelID と一致しないと表示されない・押しても届かないことがある)。一致は appIdentity.test.ts で確かめる
 */
export const APP_USER_MODEL_ID = 'com.electron.app'
