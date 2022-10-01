'use strict'

const path = require('node:path')

/** @type {import('eslint').Linter.Config} */
module.exports = {
	extends: '@cherryblossom/eslint-config/node/16',
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
			},
			rules: {
				'import/no-unused-modules': 0,
				'no-multi-assign': 0
			}
		}
	]
}
