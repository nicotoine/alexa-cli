# `alexa-cli` — Alexa routines and smart-home devices from the terminal

**For scripts and agents: `--json` or `--plain`.** Every listing (`routines`, `devices`, `appliances`, `skills`,
`audit`) writes one tab-separated record per line with `--plain`, or one JSON document with `--json`. Every command
that changes something answers a JSON document with `--json`, errors included, and only says what it would do
until it is given `--apply`.

Create voice routines, give them more ways to be said, point them at another device, switch them on and off, find
the ones a deleted device broke, and see which skill keeps bringing a device back — from the terminal or from a
small local web page.

```console
$ alexa-cli create --phrase "pause télé" --phrase "mets la télé en pause" --device "Télé pause" --apply
create "pause télé": "pause télé", "mets la télé en pause" -> turnOn Télé pause
created amzn1.alexa.automation.2ae4b900-…

$ alexa-cli phrases "reprends la télé" --add "relance la télé" --apply
$ alexa-cli retarget "on va dormir" --from "Smart TV" --device "Télé" --apply
$ alexa-cli audit
ROUTINE                  MISSING                          ID
c'est l'heure du réveil  turnOn 5e46ba56-bbb3-4992-…      amzn1.alexa.automation.2fef1c7a-…
```

> ⚠️ **Unofficial API.** Amazon offers no public API for routines. alexa-cli talks to the same internal API as the
> Alexa app, through [alexa-remote2](https://github.com/Apollon77/alexa-remote); the routine write format comes
> from the reverse-engineering done by [alexa-mcp](https://github.com/snordquist/alexa-mcp). It can change without
> notice. Use it for your own account.

## Contents

- [Install](#install) · [Sign in](#sign-in) · [Commands](#commands) · [Output for scripts](#output-for-scripts)
- [Web interface](#web-interface) · [How it works](#how-it-works) · [Troubleshooting](#troubleshooting)
- [Development](#development) · [Licence](#licence)

## Install

Node 22 or newer.

```bash
git clone https://github.com/nicotoine/alexa-cli.git
cd alexa-cli
./install.sh
```

`install.sh` installs the dependencies, links `alexa-cli` into `~/.local/bin` and sets up shell completion (bash,
zsh or fish). Each step is reported; a failed step does not stop the others.

| Option | |
|---|---|
| `--bin-dir DIR` | link somewhere else than `~/.local/bin` |
| `--shell zsh` | completion for another shell than `$SHELL` |
| `--no-completion` | skip completion |
| `--uninstall` | remove the link and the completion (the Amazon session stays) |

Re-run `./install.sh` after a `git pull`: it is idempotent.

## Sign in

```bash
alexa-cli login
```

Open <http://127.0.0.1:3456/> and sign in **on Amazon's own page**, two-step verification included. The login runs
through a proxy listening on `127.0.0.1` only: alexa-cli never sees the password and keeps only the resulting tokens,
in `~/.config/alexa-cli/auth.json` (mode `0600`). `alexa-cli status` says whether Amazon still accepts them;
`alexa-cli logout` deletes them.

The settings target Amazon France (`amazon.fr`, `fr-FR`); see `LOCALE` in [`src/model.js`](src/model.js) and the
connection settings in [`src/client.js`](src/client.js) for another country.

## Commands

A `<routine>` is named by its name, one of its phrases or its id. A `<device>` by its name or id. Run
`alexa-cli <command> --help` for every option.

### Routines

| Command | |
|---|---|
| `routines [text]` | list, filtered on name and phrases |
| `show <routine>` | the full JSON Amazon returns |
| `export <routine>` | the routine as an editable spec (below) |
| `create --from spec.json` / `--spec '<json>'` | create a routine from a spec |
| `update <routine> --from spec.json` | replace a routine with a spec, keeping its id |
| `create --phrase "…" [--phrase "…"…] --device "…" [--op turnOn\|turnOff] [--name "…"]` | quick form: a phrase that turns a device on (default) or off |
| `phrases <routine> [--add "…"]… [--remove "…"]…` | add or remove ways to say it |
| `retarget <routine> --device "…" [--from "…"] [--op …]` | same routine on another device — same id, phrases and other actions; `--from` picks which device to replace when there are several |
| `enable <routine>` / `disable <routine>` | switch on / off |
| `run <routine> [--on "<Echo>"]` | run it now, as if it had been said |
| `delete <routine>` | delete |

### Routine specs

A routine with several actions, a schedule, an Echo that answers — written as JSON, the way `export` prints it:

```json
{
  "name": "bonne nuit",
  "enabled": true,
  "when": { "say": ["bonne nuit", "au dodo"] },
  "do": [
    { "device": "Télé", "turn": "off" },
    { "device": "Lumière salon", "turn": "off" },
    { "say": "Bonne nuit, fais de beaux rêves" },
    { "wait": 10 },
    { "play": "weather", "on": "Chambre" },
    { "command": "mets de la musique douce", "on": "Chambre" }
  ]
}
```

| | |
|---|---|
| `when` | `{ "say": [phrases] }`, or `{ "at": "HH:MM", "days": ["MO","TU","WE","TH","FR","SA","SU"] }` (no `days`: every day) |
| `{ "device": "…", "turn": "on" \| "off" }` | a smart-home device, by name |
| `{ "say": "…" }` | Alexa says it |
| `{ "wait": seconds }` | 1 to 3600 |
| `{ "play": "weather" \| "time" \| "date" \| "calendar" \| "news" \| "goodmorning" }` | |
| `{ "command": "…" }` | as if said to Alexa |
| `{ "fireTv": "off", "on": "<Fire TV>" }` | |
| `{ "raw": { "type", "skillId", "payload" } }` | any other action, kept as Amazon wrote it — export → import loses nothing |
| `"on": "<Echo>"` | which Echo answers (name, or serial number for the Alexa app on a phone). Default: the one that heard the phrase; **required** on a schedule, which has none |

**Actions run in order, and Amazon makes the groups.** Whatever nesting is sent, Amazon stores a flat list and runs
each run of consecutive device actions *together with the one action that follows it* (observed on a real account:
two `say` sent "together" came back one after the other). So a spec is a flat list; `together` / `steps` blocks
are accepted but flattened, and the dry run says so.

```bash
alexa-cli export "on va dormir" > dormir.json   # edit it
alexa-cli update "on va dormir" --from dormir.json           # dry run: what would be written
alexa-cli update "on va dormir" --from dormir.json --apply
```

### Smart home

| Command | |
|---|---|
| `devices [text]` | devices a routine can target |
| `appliances [text]` | every device with its source (`matter`, `skill`), maker and reachability |
| `skills [text]` | enabled skills and the devices each one provides |
| `forget <device> [--force]` | delete a device; refused while a routine uses it |

`skills` exists because Amazon's own "your skills" page leaves most smart-home skills out: alexa-cli finds them
through the devices they provide. A device deleted with `forget` that shows up again comes from a skill that is
still linked — unlink it in the Alexa app.

### Checks and setup

| Command | |
|---|---|
| `audit` | routines with an action on a device that no longer exists |
| `snapshot` | every list over one connection, one JSON line per part as soon as it is ready |
| `login` / `logout` / `status` | the Amazon session |
| `completion bash\|zsh\|fish` | the completion script (`install-completion.sh` wires it) |

**Nothing changes without `--apply`.** `create`, `phrases`, `retarget`, `enable`, `disable`, `delete` and `forget`
print what they would do and stop; add `--apply` to do it. `run` acts at once.

## Output for scripts

| Mode | stdout | Errors | Use it for |
|---|---|---|---|
| default | aligned columns, colour on a terminal | `error: …` on stderr | a person |
| `--plain` | one record per line, fields separated by tabs; lists joined by ` \| `; tabs and newlines escaped as `\t` `\n` | on stderr | `cut`, `awk`, an agent reading a listing |
| `--json` | one JSON document, nothing else | `{"error": "…"}` on stdout | anything that parses |

Notes for a person — "dry run", "nothing to show" — always go to stderr. The exit code is the signal in every mode:
`0` done, `1` failed, `2` wrong usage.

```bash
alexa-cli routines --plain | cut -f2              # names
alexa-cli audit --json | jq -r '.[].name'          # broken routines
alexa-cli delete "test" --apply --json | jq .applied
```

## Web interface

```bash
npm run ui:build   # once, and after an update (install.sh does it)
npm run ui         # → http://127.0.0.1:3457/
```

A React + [Ionic](https://ionicframework.com/) app over the CLI, built for a phone first and fine on a computer.

- **Routines**: search, sort, filters (folded behind a button on a phone), an on/off switch per routine, phrases
  added or removed in place, run, delete — and a **routine editor**: name, phrases or a schedule with its days, then
  the actions as one list reordered by dragging (device on/off with a searchable device picker, say, wait, weather /
  time / news…, tell Alexa, Fire TV off), on the Echo of your choice. It is checked as you type by the CLI's own rules
  and written with the CLI's own translation (`src/routine-spec.js`, imported as is).
- **Devices** (a table sorted by its column headers on a wide screen, a list on a phone), **Skills**, **Audit**.
- **Activity queue.** Every change is drawn at once and followed in a compact bar at the bottom — a loader while it
  runs, the outcome after; a deletion waits five seconds with **Annuler**. Tapping the bar opens a sheet with every
  action (retry, force) and the **journal** of the changes the interface applied, kept in
  `~/.config/alexa-cli/journal.jsonl`.
- **Streamed and cached.** One connection sends each list as soon as it is ready, routines first; the server keeps the
  last one, so the page draws at once and refreshes behind.
- **Signing in from the page** when no session is accepted (there is no terminal on a phone).
- **Local only.** The server listens on `127.0.0.1`, refuses any other host name, runs only a whitelist of CLI
  commands with arguments passed without a shell, and requires a header a page from another site cannot send.

`npm run ui:dev` serves the app with hot reload (Vite), talking to `npm run ui` for the data.

## How it works

The Alexa app reads routines from `/api/behaviors/v2/automations` but writes them through
`/api/behaviors/automations` — a `POST` to the v2 path answers 404 — with a body that looks nothing like what it
reads: flat, the trigger and the sequence as JSON *strings*, the phrase payload a JSON string inside that, and every
action normalised by `/api/behaviors/operation/validate` first. A malformed write answers **HTTP 200** with
`{"message": "Input failed to validate."}`, so alexa-cli checks the answer, not the status.

There is no partial update: changing a phrase or a status is a full rebuild of the routine from its current state
and a `PUT`, every action re-validated, as the app does. That is why `retarget` keeps the id, the other phrases and
the other actions.

Request bodies escape every non-ASCII character (`é`). Sent as is, Amazon stored "télé" as "tÃ©lÃ©" — a phrase
no one can say.

## Troubleshooting

| Symptom | Cause, fix |
|---|---|
| `not logged in` | `alexa-cli login` |
| `401 Unauthorized`, `Cookie invalid` | the session expired: `alexa-cli login` again |
| `phrase already used by: …` | another routine answers to it; `alexa-cli routines "<phrase>"` finds which |
| a phrase is never recognised | check it with `show`: accents must read correctly |
| a forgotten device comes back | its skill is still linked: `alexa-cli skills <name>`, then unlink the skill in the Alexa app |
| `retarget needs exactly one matching device action` | the routine controls several devices: say which with `--from` |
| what is the CLI sending? | `--debug` logs every request to stderr (truncated) |

## Development

```bash
npm test                  # CLI and interface, offline (a fake Alexa client)
npm run surface:update    # re-pin the command surface, when it is meant to change
```

```
bin/alexa-cli.js          entry point
src/
  cli.js                  front end: global options, help, dispatch, error rendering
  args.js                 declared commands → parser, --help, completion, pinned surface
  commands/               one module per feature: routines, devices, skills, audit, account, completion
  model.js                routines, devices and skills: reading and the write format — pure, no network
  client.js               the Alexa API (the only module that knows alexa-remote2)
  auth.js                 where the tokens live
  context.js              the lazily connected client, the --apply guard
  ui.js                   human, --plain and --json output
interface/
  server/                 app (routes, protections), writes (whitelist), cli-runner (subprocess / in-process),
                          journal, index
  app/                    the React + Ionic app (Vite): src/lib (pure, tested: store, activity, actions, listing,
                          model, prefs, api, explain), src/state, src/components, src/views
  test/
test/                     node:test suites; command_surface.json pins every command and option
```

The conventions are in [`CLAUDE.md`](CLAUDE.md).

## Licence

MIT — see [`LICENSE`](LICENSE). Parts are adapted from [alexa-mcp](https://github.com/snordquist/alexa-mcp)
(MIT, © Sascha Nordquist).
