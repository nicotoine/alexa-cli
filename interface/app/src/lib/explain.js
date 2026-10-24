// The CLI's English errors, said in French when they are known ones. Pure: tested in Node.

const KNOWN = [
    [/phrase already used by: (.*)/, (m) => `Phrase déjà utilisée par « ${m[1]} ».`],
    [/still used by \d+ routine\(s\): (.*?) \(--force/, (m) => `Encore utilisé par : ${m[1]}.`],
    [/not logged in/, () => 'Non connecté à Amazon.'],
    [/401|Unauthorized|Cookie invalid/, () => 'Session Amazon expirée : reconnecte-toi.'],
    [/no routine matches/, () => 'Cette routine n\'existe plus chez Amazon.'],
    [/no device is named "(.*)"/, (m) => `Aucun appareil ne s'appelle « ${m[1]} ».`],
    [/no Echo is named "(.*)"/, (m) => `Aucun Echo ne s'appelle « ${m[1]} ».`],
    [/a routine needs at least one phrase/, () => 'Une routine garde au moins une phrase.'],
    [/needs "on": a scheduled routine/, () => 'Une routine programmée doit dire quel Echo répond, pour chaque action qui parle.'],
    [/"do" needs at least one step/, () => 'Ajoute au moins une action.'],
    [/"when.say" needs at least one phrase/, () => 'Ajoute au moins une phrase.'],
    [/"when.at" must be HH:MM/, () => 'Choisis une heure.'],
    [/\.(say|command) needs a text/, () => 'Une action a un texte vide.'],
    [/\.wait must be 1 to 3600 seconds/, () => 'Une attente doit durer de 1 à 3600 secondes.'],
    [/needs "fireTv": "off" and "on"/, () => 'Choisis la Fire TV à éteindre.'],
    [/needs "turn": "on" or "off"/, () => 'Choisis allumer ou éteindre.'],
    [/Input failed to validate/, () => 'Amazon a refusé la modification (données invalides).'],
    [/Failed to fetch|NetworkError/, () => 'Serveur de l\'interface injoignable.'],
];

export function explain(message) {
    const m = String(message || '').trim().replace(/^error: /, '');
    for (const [pattern, say] of KNOWN) {
        const match = m.match(pattern);
        if (match) return say(match);
    }
    return m || 'Erreur inconnue.';
}
