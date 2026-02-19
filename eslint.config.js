import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.test.ts', 'src/*.test.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'eslint.config.js'],
  },
);
