#!/usr/bin/env node
import { main } from '../src/cli.js';

process.exitCode = await main(process.argv.slice(2));
// alexa-remote2 keeps sockets open after the work is done, so the process is ended here, once stdout has been
// flushed: exiting straight away cut piped output (a long --json) at 64 KB.
process.stdout.write('', () => process.exit(process.exitCode));
