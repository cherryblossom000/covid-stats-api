'use strict'

const path = require('path')

/** @type {import('eslint').Linter.Config} */
module.exports = {
  overrides: [
    {
      files: '.eslintrc.cjs',
      extends: '@cherryblossom/eslint-config/js/node/commonjs'
    },
    {
      files: '**/*.ts',
      extends: '@cherryblossom/eslint-config/ts/node/esm',
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: path.dirname(__dirname)
      }
    }
  ]
}
