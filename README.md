# alexa-cli

Gérer les appareils de maison connectée et les routines vocales Alexa depuis le terminal : lister,
créer, ajouter des phrases, changer d'appareil, activer, lancer, supprimer, et repérer les routines
cassées.

> **API non officielle.** alexa-cli parle à l'API interne de l'appli Alexa, à travers
> [alexa-remote2](https://github.com/Apollon77/alexa-remote). Amazon peut la changer à tout moment.
> Le format d'écriture des routines vient de la rétro-ingénierie faite par
> [alexa-mcp](https://github.com/snordquist/alexa-mcp).

## Installation

```bash
git clone https://github.com/nicotoine/alexa-cli.git
cd alexa-cli
npm install
ln -s "$PWD/cli.js" ~/.local/bin/alexa-cli   # ou : npm link
```

Node 18 ou plus récent.

## Connexion

```bash
alexa-cli login
```

Ouvrez <http://127.0.0.1:3456/> et connectez-vous **sur la page d'Amazon** (double authentification
comprise). Le proxy n'écoute que sur `127.0.0.1` ; alexa-cli ne voit pas le mot de passe et ne garde que
les jetons, dans `~/.config/alexa-cli/auth.json` (droits `0600`). `alexa-cli logout` les efface.

Les réglages visent Amazon France (`amazon.fr`, `fr-FR`) : voir les constantes en tête de `cli.js`
pour un autre pays.

## Commandes

Une `<routine>` se désigne par son nom, une de ses phrases ou son identifiant. Tout ce qui modifie
quelque chose **affiche seulement ce qui serait fait** tant que `--apply` n'est pas passé.

| Commande | Effet |
|---|---|
| `devices [texte]` | appareils qu'une routine peut viser (nom, identifiant) |
| `appliances [texte]` | appareils avec leur source (`AAA` = Matter, `SKILL` = skill) |
| `forget <appareil> [--force] --apply` | supprime un appareil d'Alexa ; refusé tant qu'une routine l'utilise |
| `routines [texte]` | liste les routines |
| `show <routine>` | JSON complet |
| `create --phrase "…" [--phrase "…"] --device "…" [--op turnOn\|turnOff] [--name "…"] --apply` | routine vocale qui allume (par défaut) ou éteint un appareil |
| `phrases <routine> [--add "…"] [--remove "…"] --apply` | ajoute ou retire des façons de dire la routine |
| `retarget <routine> --device "…" [--op …] --apply` | même routine sur un autre appareil (même identifiant) |
| `enable <routine> --apply` / `disable <routine> --apply` | active / désactive |
| `run <routine> [--on "<Echo>"]` | lance la routine maintenant |
| `delete <routine> --apply` | supprime |
| `audit` | routines dont l'appareil visé n'existe plus |

`--json` donne la sortie brute pour `devices`, `appliances` et `routines`.

## Exemples

```bash
alexa-cli create --phrase "pause télé" --phrase "mets la télé en pause" --device "Télé pause" --apply
alexa-cli phrases "reprends la télé" --add "relance la télé" --apply
alexa-cli retarget "éteint la télé" --device "Télé" --apply
alexa-cli audit
```

## Bon à savoir

- **Accents** : le corps des requêtes est envoyé avec les caractères non ASCII échappés (`é`) ;
  envoyés tels quels, Amazon enregistrait « tÃ©lÃ© » et la phrase n'était jamais reconnue.
- **Erreurs déguisées** : une écriture refusée répond HTTP 200 avec
  `{"message":"Input failed to validate."}` ; alexa-cli lit la réponse et signale l'échec.
- **Pas de nouvelle tentative à la création** : une réponse perdue après une création réussie
  dupliquerait la routine.
- **Modifier** (`phrases`, `retarget`, `enable`, `disable`) reconstruit la routine entière à partir de
  son état actuel et revalide chaque action, comme le fait l'appli.
- Seules les routines à **un** déclencheur vocal se modifient avec `phrases` ; `create` et `retarget`
  ne gèrent qu'une action de maison connectée (allumer / éteindre).

## Licence

MIT. Des parties sont adaptées d'[alexa-mcp](https://github.com/snordquist/alexa-mcp) (MIT,
© Sascha Nordquist) : voir `LICENSE`.
