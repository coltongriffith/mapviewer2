import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Lint configuration (audit P2-02). The repository previously had none, so
// nothing caught unused variables, broken hook dependencies, or the
// accessibility patterns the audit found across the JSX.
//
// The accessibility rules are deliberately set to "warn" for now: the existing
// tree has a large backlog (labels not associated with controls, click
// handlers on non-interactive elements) and turning them into errors today
// would block every unrelated change. CI runs with --max-warnings set high
// enough to pass while still surfacing the count, and the correctness rules
// below DO fail the build.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'data/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // Injected by Vite's `define` (see vite.config.js).
        __APP_VERSION__: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // ── Correctness: these fail the build ──
      // Marks a component referenced as <Foo /> as used. Without this rule
      // no-unused-vars cannot see JSX at all, and every imported component
      // in the tree was reported as unused — which is where most of the
      // "~200 pre-existing unused bindings" in the earlier comment came from.
      'react/jsx-uses-vars': 'error',
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // Empty catch blocks are used deliberately throughout for best-effort
      // work (analytics, clipboard, localStorage in private mode).
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Unused bindings. The tree was cleaned to zero in the 2026-09 review
      // (most of the old "~200 backlog" was JSX usage the linter could not
      // see, see jsx-uses-vars above), so a new one is a defect — a leftover
      // import or a value computed and dropped — and fails the build.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^(React|_)',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // ── Known backlog: reported, not yet blocking ──
      'react-hooks/exhaustive-deps': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/alt-text': 'warn',
    },
  },
  {
    // Test files: vitest globals, and imported-but-unused fixtures/components
    // are a normal pattern in setup blocks.
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  {
    // Build/data scripts run in Node.
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.js', 'api/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
