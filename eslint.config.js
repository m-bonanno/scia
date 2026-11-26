import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noFixedSleep from './scripts/lint/no-fixed-sleep.mjs';

// Later blocks override earlier ones for the same rule: the most specific scope comes last. A
// block that sets `no-restricted-syntax` replaces the list of every block before it, so it names
// every group of selectors its files keep. Each rule is held by scripts/lint-rules.test.mjs.

const NODE_GLOBALS = ['process', 'Buffer', 'require', '__dirname', '__filename'];

// A selector for each place a string's text is written: a string, and a template's own text.
const inText = (pattern, message) => [
  { selector: `Literal[value=${pattern}]`, message },
  { selector: `TemplateElement[value.cooked=${pattern}]`, message },
];

const RAW_COLOUR =
  'A raw colour: use a token of src/themes.css, named for Tailwind in src/styles.css (apps/renderer/CLAUDE.md, "Tokens, never raw colours"). An id or an issue number spelled in hex digits (`#add`, `#138`) reads as one too.';

// A class or a value stands alone in its text when no letter, digit or `-` touches it: Tailwind's
// `_` (its space inside an arbitrary value) and `!` (its important mark) do not.
const ALONE_BEFORE = String.raw`(?<![\da-z-])`;
const ALONE_AFTER = String.raw`(?![\da-z-])`;

const RENDERER_SYNTAX = [
  ...inText(
    `/${ALONE_BEFORE}#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})${ALONE_AFTER}/i`,
    RAW_COLOUR,
  ),
  ...inText(String.raw`/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/`, RAW_COLOUR),
  // Tailwind's own palette, each utility of the Tailwind this repository installs (4.3.5) that takes
  // one, its masks among them: a class the page's tokens did not name.
  ...inText(
    `/${ALONE_BEFORE}(?:bg|text|border(?:-(?:[xytrblse]|bs|be))?|outline|ring(?:-offset)?|inset-ring|shadow|inset-shadow|text-shadow|drop-shadow|fill|stroke|from|via|to|decoration|accent|caret|divide|placeholder|scrollbar-(?:thumb|track)|mask-(?:[trblxy]|linear|radial|conic)-(?:from|to))-(?:white|black|(?:slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3})${ALONE_AFTER}/`,
    RAW_COLOUR,
  ),
  ...inText(
    `/${ALONE_BEFORE}(?:not-)?dark:/`,
    'No `dark:` variant: a colour that changes is a token, defined by every theme in its dark and in its light variant (apps/renderer/CLAUDE.md, "Tokens, never raw colours").',
  ),
  {
    selector: "MemberExpression:matches([property.name='toFixed'], [property.value='toFixed'])",
    message:
      'Never `toFixed`: a number goes through lib/format.ts, in the one LOCALE of @scia/contracts/locale (apps/renderer/CLAUDE.md, "Numbers are tabular-nums").',
  },
];

const SEPARATOR =
  'A hard-coded `\\` separator: build the path with `path.join`, since CI runs every spec on Linux and on Windows (docs/development/testing.md, "Writing a spec").';

// A path built with `\`: beside a template's `${…}`, beside a `+`, or given to `join` and `split`.
// A Windows path that is a value, such as a setting's folder, is left alone.
const SPEC_SYNTAX = [
  { selector: String.raw`TemplateElement[tail=false][value.cooked=/\\$/]`, message: SEPARATOR },
  {
    selector: String.raw`TemplateElement:not(:first-child)[value.cooked=/^\\/]`,
    message: SEPARATOR,
  },
  {
    selector: String.raw`BinaryExpression[operator='+'] > Literal.left[value=/\\$/]`,
    message: SEPARATOR,
  },
  {
    selector: String.raw`BinaryExpression[operator='+'] > Literal.right[value=/^\\/]`,
    message: SEPARATOR,
  },
  {
    selector: String.raw`CallExpression[callee.property.name=/^(?:join|split)$/][arguments.0.value=/^\\$/]`,
    message: SEPARATOR,
  },
];

// `join(tmpdir(), 'scia')`: a name known in advance, which `mkdtemp`'s own prefix is not.
const FIXED_TEMP_FOLDER = [
  {
    selector: [
      'CallExpression',
      ':matches([callee.name=/^(?:join|resolve)$/], [callee.property.name=/^(?:join|resolve)$/])',
      ":matches([arguments.0.callee.name='tmpdir'], [arguments.0.callee.property.name='tmpdir'])",
      ":matches([arguments.1.type='Literal'], [arguments.1.type='TemplateLiteral'][arguments.1.expressions.length=0])",
      ':not(:matches(CallExpression[callee.name=/^mkdtemp(?:Sync)?$/], CallExpression[callee.property.name=/^mkdtemp(?:Sync)?$/]) > CallExpression)',
    ].join(''),
    message:
      "A folder of a fixed name in the system's temporary folder is anyone's to make first, or to swap for a link: make it whole with `mkdtemp(join(tmpdir(), '<prefix>'))` (.claude/gotchas/engine.md, #371).",
  },
];

const WALL_CLOCK = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Take the time as an argument instead of reading the wall clock.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Take the time as an argument instead of reading the wall clock.',
  },
];

const SPECS = ['**/*.test.{ts,tsx,mjs}'];

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
      '.stryker-tmp/**',
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
            'vitest.workers.ts',
            'vitest.stryker.config.ts',
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
      'no-restricted-syntax': ['error', ...FIXED_TEMP_FOLDER],
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
      'no-restricted-syntax': ['error', ...WALL_CLOCK, ...FIXED_TEMP_FOLDER],
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
  // The rules of what a person sees: a spec of the renderer names issues and reads text its own way.
  {
    files: ['apps/renderer/src/**/*.{ts,tsx}'],
    ignores: SPECS,
    rules: { 'no-restricted-syntax': ['error', ...RENDERER_SYNTAX, ...FIXED_TEMP_FOLDER] },
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
  {
    files: SPECS,
    plugins: { scia: { rules: { 'no-fixed-sleep': noFixedSleep } } },
    rules: {
      'scia/no-fixed-sleep': 'error',
      'no-restricted-syntax': ['error', ...SPEC_SYNTAX, ...FIXED_TEMP_FOLDER],
    },
  },
);
