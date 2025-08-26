import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'node_modules/**', 'config/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
   
    rules: {
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'indent': ['error', 2],
      'no-console': 'off',
      'object-curly-spacing': ['error', 'always'],
      'eol-last': [2, 'always'],
    }
  }
);
