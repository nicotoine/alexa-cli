// Which alexa-cli this is: the version from package.json, and — in a build made by scripts/build-apk.sh or the CI —
// the built version (<major>.<minor>.<build number>), build number and commit written next to it in build.json. A
// checkout run from source has no build.json.

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
    if (!build) return { version, build: null, commit: null, builtAt: null, label: version };
    // An older build.json has no version: it was named <version>-<build>.
    const built = build.version || `${version}-${build.build}`;
    return { version: built, build: build.build, commit: build.commit, builtAt: build.builtAt, label: `${built} (${build.commit})` };
}
