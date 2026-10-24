# Working in this repo

A Node CLI over the Alexa app's unofficial API, and a local web page over the CLI. The shape follows the Uxopian CLIs
(`~/uxo/uxopian-cli`): a thin front end, one module per feature, output in three modes, a pinned command surface.
`npm test` checks all of it offline.

## Layout

```
bin/alexa-cli.js       entry point: runs main(), exits once stdout is flushed
src/cli.js             the front end — global options, help, dispatch, error rendering. No business logic.
src/args.js            commands are declared; the parser, --help, completion and the surface come from that
src/commands/          one module per feature; each exports an array of commands
src/commands/index.js  registration: the order --help lists them
src/model.js           routines/devices/skills: reading, writing, audit. Pure — the network is passed in.
src/client.js          the Alexa API. The only module that imports alexa-remote2.
src/context.js         the client, connected on first use; act() — the --apply guard
src/ui.js              human / --plain / --json
interface/server/      app.js (routes, protections), writes.js (whitelist), cli-runner.js (queue, stream)
interface/public/js/   store.js (optimistic engine, no DOM), listing.js (sort, filter — pure), prefs.js, actions.js, api.js, model.js, toasts.js, views/
```

**Commands are declared, not attached.** A command module exports `{ name, group, summary, args, options, modes,
run }` objects and `commands/index.js` registers them; a module never imports `cli.js`, which imports it.

**`cli.js` is a front end.** If it starts holding what a command does, that belongs in the command or in `model.js`.

## Conventions

- **Comments explain why, not what.** Most of them record a failure that happened (the 404 on a v2 POST, "télé"
  stored as "tÃ©lÃ©", a DELETE that silently did nothing). Keep them next to the code they explain when moving it.
- **Nothing changes without `--apply`.** A command that writes declares `APPLY` and goes through `act()`; the
  surface test fails if a write command lacks it or a read command has it.
- **`--json` is a contract.** stdout carries the document and nothing else, errors are `{"error": …}`, the exit
  code is the signal (0 / 1 failed / 2 usage). Notes for a person go to stderr through `out.note`.
- **Every listing has `--plain`.** One record per line, tab-separated, never wrapped or padded; a list in a field is
  joined by ` | `; tabs and newlines are escaped. Decide a command's shape — document or listing — before writing
  it.
- **Every network call goes through `AlexaClient`.** `model.js` stays testable without a network; a write that needs
  `/operation/validate` receives it as a function.
- **Write bodies go through `asciiJson`.** Never `JSON.stringify` a body sent to Amazon.
- **Create is never retried.** A lost answer to a POST that went through would duplicate the routine.
- **The page builds DOM with `el()` only.** Amazon's text never goes through `innerHTML`.
- **A patch in the store is idempotent and tolerates a list that is still null.** It runs again on every recompute.

## Tests

```bash
npm test                         # everything, offline
node --test test/commands.test.js
npm run surface:update           # only when the command surface is meant to change — say so in the commit
```

- `test/fixtures.js` holds trimmed real shapes and `fakeClient()`, which records what would have been sent.
- `test/helpers.js` runs `main()` against it and captures stdout, stderr and the exit code.
- `test/command_surface.json` pins every command with its parameters' name, type and arity. A dropped command
  raises nothing at import time — the CLI just stops doing something — so it fails there.
- The interface's server is tested over real HTTP with a stub runner; the store and actions with a fake `change`
  and a manual clock and scheduler.

Nothing in the suite talks to Amazon. Checking a change against the real account is done by hand with a throwaway
routine (`create --phrase "test cli" … --apply`, then `delete "test cli" --apply`), never on the user's routines.

## Not in git

`node_modules/`, and the session in `~/.config/alexa-cli/` (outside the repo by design).
