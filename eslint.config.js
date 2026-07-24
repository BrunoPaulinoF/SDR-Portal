import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // scripts/*.mjs sao utilitarios avulsos de manutencao rodados com `node`, fora do build.
    ignores: ['dist/**', 'node_modules/**', 'drizzle/**', 'local-secrets/**', 'scripts/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
);
