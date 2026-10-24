// The entry point nodejs-mobile starts inside the app. CommonJS because the plugin's `bridge` module is a require();
// everything else is the CLI and the interface server, unchanged, loaded as ES modules from ./app.
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { getDataPath } = require('bridge');

// A phone has no home directory: the session, the journal and the cache live in the app's private data directory.
process.env.ALEXA_CLI_CONFIG_DIR = path.join(getDataPath(), 'alexa-cli');
// No `node` binary to start on a phone: the server calls the CLI in this process, one Amazon connection kept open.
process.env.ALEXA_CLI_RUNNER = 'inprocess';

import(pathToFileURL(path.join(__dirname, 'app', 'interface', 'server', 'index.js')).href)
    .then(({ start }) => start())
    .then(() => console.log('alexa-cli interface: http://127.0.0.1:3457/'))
    .catch((e) => console.error('alexa-cli could not start:', e && e.stack ? e.stack : e));
