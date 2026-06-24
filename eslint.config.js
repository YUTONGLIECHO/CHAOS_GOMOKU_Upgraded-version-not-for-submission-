// Flat config.
export default [
  { ignores: ['web-app/vendor/**', 'docs/**', 'dist/**', 'node_modules/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['warn', { caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
    },
  },
];
