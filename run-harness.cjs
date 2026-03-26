'use strict';
// CJS runner for harness tests — avoids Mocha CLI's ESM detection on Node 22
require('./client/test/harness/setup.js');
require('ts-node').register({
  project: './client/tsconfig.json',
  transpileOnly: true,
});
const Mocha = require('mocha');
const path = require('path');
const { globSync } = require('glob');

const mocha = new Mocha({ ui: 'bdd', reporter: 'spec', timeout: 10000 });

const pattern = process.argv[2] || './client/test/harness/**/*.test.ts';
const files = globSync(pattern, { cwd: process.cwd() });
if (files.length === 0) {
  console.error('No test files found matching:', pattern);
  process.exit(1);
}
files.forEach(f => mocha.addFile(path.resolve(f)));
mocha.run(failures => { process.exitCode = failures ? 1 : 0; });
