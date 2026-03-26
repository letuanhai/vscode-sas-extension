const path = require('path');
const ROOT = '/nfs/homelab-fileshare/dev/vscode-sas-extension';
require(path.join(ROOT, 'client/test/harness/setup.js'));
require('ts-node').register({project: path.join(ROOT, 'client/tsconfig.json')});
const Mocha = require('mocha');
const mocha = new Mocha({ui: 'bdd', reporter: 'spec'});
mocha.addFile(path.join(ROOT, 'client/test/harness/studioweb-state.test.ts'));
mocha.run(failures => {
  process.exitCode = failures ? 1 : 0;
});
