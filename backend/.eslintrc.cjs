module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: ['.eslintrc.cjs', 'dist/**', 'coverage/**'],
  rules: {
    // Les décorateurs Nest exigent des métadonnées de type que l'inférence ne
    // fournit pas : les annotations explicites sur les membres injectés sont
    // nécessaires, pas verbeuses.
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',

    // `any` masque exactement les erreurs que TypeScript devrait attraper.
    '@typescript-eslint/no-explicit-any': 'error',

    // Une promesse non attendue échoue silencieusement : dans un service de
    // commande, cela signifie une écriture perdue sans aucune trace.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // §13.4 — aucune fonction de plus de 50 lignes.
    'max-lines-per-function': ['warn', { max: 80, skipComments: true, skipBlankLines: true }],
    'max-lines': ['warn', { max: 400, skipComments: true, skipBlankLines: true }],

    'no-console': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
  overrides: [
    {
      // Les schémas Mongoose sont déclaratifs : le plafond de lignes n'y a pas
      // de sens, et les découper éloignerait un index de son champ.
      files: ['**/*.schema.ts', '**/*.spec.ts'],
      rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
    },
  ],
};
