import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Later blocks override earlier ones for the same rule: the most specific scope comes last.

const NODE_GLOBALS = ['process', 'Buffer', 'require', '__dirname', '__filename'];

const BROWSER_IMPORT_PATTERNS = [
  { group: ['node:*'], message: 'This code runs in a browser page, not in Node.' },
  {
    group: ['@scia/server'],
    allowTypeImports: true,
    message: 'The engine is reached over HTTP only (type imports are fine).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/.dev/**',
      '**/.dev-profile/**',
      '.claude/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'vitest.config.ts',
            'apps/renderer/vite.config.ts',
            'apps/renderer/vitest.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  {
    files: ['packages/**/*.ts', 'apps/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The engine runs under plain Node in tests and dev.' },
          ],
        },
      ],
    },
  },
  {
    // The engine's log is its standard output, which main copies into its own file.
    files: ['apps/server/src/entry.ts', 'apps/server/src/dev.ts', 'apps/server/src/main.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'electron', 'hono', 'hono/*', 'react', 'react-dom', 'zod'],
              message:
                'packages/core is pure TypeScript: no IO, no frameworks (packages/core/CLAUDE.md).',
            },
            {
              group: ['@scia/*'],
              message: 'packages/core depends on nothing in the monorepo.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NODE_GLOBALS, 'fetch'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Take the time as an argument instead of reading the wall clock.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Take the time as an argument instead of reading the wall clock.',
        },
      ],
    },
  },

  {
    files: ['apps/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'no-restricted-globals': ['error', ...NODE_GLOBALS],
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: BROWSER_IMPORT_PATTERNS }],
    },
  },

  {
    files: ['apps/extension/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: {
      'no-restricted-globals': ['error', ...NODE_GLOBALS],
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: BROWSER_IMPORT_PATTERNS }],
    },
  },

  {
    files: ['apps/desktop/src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'Engines are pure: wire Electron in an adapter.' }],
        },
      ],
    },
  },

  // The sandboxed preload compiles as CommonJS: `require` is the only import form.
  {
    files: ['apps/desktop/src/preload.cts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', '**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
