// Re-pins test/command_surface.json from the code. Run only when the surface is meant to change.
import fs from 'node:fs';
import { commandSurface } from '../src/args.js';
import { PROG } from '../src/cli.js';
import { COMMANDS } from '../src/commands/index.js';

const surface = commandSurface(PROG, COMMANDS);
const sorted = Object.fromEntries(Object.keys(surface).sort().map((k) => [k, surface[k]]));
fs.writeFileSync(new URL('./command_surface.json', import.meta.url), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`pinned ${Object.keys(sorted).length} commands`);
