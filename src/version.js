// Which alexa-cli this is: the version from package.json, and — in a build made by scripts/build-apk.sh or the CI —
// the build number and commit written next to it in build.json. A checkout run from source has no build.json.

import fs from 'node:fs';

const read = (name) => {
    try {
        return JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
    } catch {
        return null;
    }
};

export function versionInfo() {
    const { version } = read('package.json') || { version: '0.0.0' };
    const build = read('build.json');
    return {
        version,
        build: build ? build.build : null,
        commit: build ? build.commit : null,
        builtAt: build ? build.builtAt : null,
        label: build ? `${version}-${build.build} (${build.commit})` : version,
    };
}
