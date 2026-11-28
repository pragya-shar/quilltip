import nextPlugin from '@next/eslint-plugin-next'
import reactPlugin from 'eslint-plugin-react'
import hooksPlugin from 'eslint-plugin-react-hooks'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import noBufferGlobal from './scripts/eslint/no-buffer-global.mjs'
import oneComponentPerFile from './scripts/eslint/one-component-per-file.mjs'

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'convex/_generated/**',
      'lib/stellar/v2/bindings/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      'app/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'system/**/*.{ts,tsx}',
      'shell/**/*.{ts,tsx}',
      'surfaces/**/*.{ts,tsx}',
    ],
    ignores: ['components/ui/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    plugins: {
      local: { rules: { 'one-component-per-file': oneComponentPerFile } },
    },
    rules: { 'local/one-component-per-file': 'error' },
  },
  {
    // The Convex default runtime and the browser have no global Buffer.
    // lib/stellar/v2/tab/ is shared by both.
    files: ['convex/**/*.ts', 'lib/stellar/v2/tab/**/*.ts'],
    plugins: {
      quilltip: { rules: { 'no-buffer-global': noBufferGlobal } },
    },
    rules: { 'quilltip/no-buffer-global': 'error' },
  },
  {
    // Browser code takes Zod from lib/zod.ts, which turns off the eval probe
    // that the content security policy blocks.
    files: [
      'app/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
      'lib/**/*.{ts,tsx}',
      'system/**/*.{ts,tsx}',
      'shell/**/*.{ts,tsx}',
      'surfaces/**/*.{ts,tsx}',
    ],
    ignores: ['lib/zod.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message: "Import { z } from '@/lib/zod' (CSP-safe settings).",
            },
          ],
        },
      ],
    },
  },
  {
    // The application shell and its surfaces link through AppLink, which
    // decides prefetch (never a legacy page; on intent only for a page
    // behind the proxy's route check). This block repeats the Zod rule
    // because a later no-restricted-imports replaces an earlier one.
    files: [
      'app/(app)/**/*.{ts,tsx}',
      'system/**/*.{ts,tsx}',
      'shell/**/*.{ts,tsx}',
      'components/{read,pocket,today,shelf,write,writer,search,you,signin,resources,ops}/**/*.{ts,tsx}',
    ],
    ignores: ['system/components/AppLink.tsx', 'system/components/Avatar.tsx'],
    rules: {
      // A person's image goes through Avatar, which accepts only this
      // deployment's storage or a same-site path and sends no referrer.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='img']",
          message:
            "Draw a person's image with Avatar from '@/system/components/Avatar' (allowed sources, no referrer). Other images need their own reviewed component.",
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message: "Import { z } from '@/lib/zod' (CSP-safe settings).",
            },
            {
              name: 'next/image',
              message:
                "Draw a person's image with Avatar from '@/system/components/Avatar' (allowed sources, no referrer).",
            },
            {
              name: 'next/link',
              importNames: ['default'],
              message:
                "Link with AppLink from '@/system/components/AppLink': it decides prefetch for legacy pages and pages behind the route check.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': hooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...jsxA11yPlugin.flatConfigs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
]
