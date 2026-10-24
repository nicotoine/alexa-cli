// Every command, in the order `--help` lists them. A command module only declares; registration is here, so a
// module never has to import the CLI that imports it.

import account from './account.js';
import audit from './audit.js';
import completion from './completion.js';
import devices from './devices.js';
import routines from './routines.js';
import skills from './skills.js';

export const COMMANDS = [...routines, ...devices, ...skills, ...audit, ...account, ...completion];
