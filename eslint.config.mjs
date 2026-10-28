import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

// テストの再帰削除は、一時ディレクトリの中だけを消すガードを通す(L-618。2026-10-26 にテストの rmSync('.') がリポジトリを .git ごと消した)。
// 呼び出しの引数のオブジェクトリテラルに recursive の欄があれば止める(recursive: false も止める。再帰しないなら欄を書かない)。
// すり抜ける形(既知の制約): オプションを変数で渡す・スプレッド・別名の import・別名の分割代入(const { rmSync: remove } = fs)・
// 計算されたキー・計算されたメンバー(fs['rmSync'](...))・型の表明(as・satisfies)。レビューと grep で補う。
// rimraf・fs-extra の削除の関数(remove・removeSync・emptyDir など)は、オプションなしで再帰削除するので、この規則では止まらない。
// どちらも直接の依存には無いが、推移的な依存として入っていて import はできる(設計書の「やらないこと」で範囲外とした)
// 今は検出しない形は、tempDirGuard.lint.test.ts の KNOWN_ESCAPES で固定している(規則を強めたら、このコメントと表を一緒に直す)
const RECURSIVE_RM_MESSAGE =
  'テストの再帰削除は @shared/__tests__/helpers/tempDirGuard の removeTempPathSync・removeTempPath を通してください(L-618)'
const RECURSIVE_RM_OPTION =
  "> ObjectExpression > Property:matches([key.name='recursive'], [key.value='recursive'])"

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // scripts/ の .mjs は型注釈の無い素の JS(Node 用のビルド補助)なので、戻り値の型の必須化は対象外にする
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // テストのファイルとテストの補助(__tests__ の下)だけにかける。本番のコードは一時ディレクトリの外も正しく消す必要がある
    files: [
      'src/**/__tests__/**/*.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'scripts/**/__tests__/**/*.mjs',
      'scripts/**/*.test.mjs'
    ],
    // ガードの実装だけを、このブロックの規則から外す(flat config の ignores はこのブロックだけに効く)
    ignores: ['src/shared/__tests__/helpers/tempDirGuard.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.type='Identifier'][callee.name=/^(rm|rmSync|rmdir|rmdirSync)$/] ${RECURSIVE_RM_OPTION}`,
          message: RECURSIVE_RM_MESSAGE
        },
        {
          selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(rm|rmSync|rmdir|rmdirSync)$/] ${RECURSIVE_RM_OPTION}`,
          message: RECURSIVE_RM_MESSAGE
        }
      ]
    }
  },
  eslintConfigPrettier
)
