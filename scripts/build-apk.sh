#!/usr/bin/env bash
# Builds the Android app: the web interface and alexa-cli in one APK, with Node.js embedded (nodejs-mobile, through
# the capacitor-nodejs plugin). The phone runs the same CLI and interface server as a computer, in-process.
#
# Usage:
#   scripts/build-apk.sh                 # release APKs: one per architecture (arm64-v8a, armeabi-v7a, x86_64)
#                                        # and a universal one
#   scripts/build-apk.sh --debug         # the same, debuggable
#   scripts/build-apk.sh --abi arm64-v8a # one architecture only, a single APK
#
# Signing: the open-source key in mobile/android/app (every build installs over the previous one), or a private key
# given in the environment: ALEXA_CLI_KEYSTORE (path), ALEXA_CLI_KEYSTORE_PASSWORD, ALEXA_CLI_KEY_ALIAS,
# ALEXA_CLI_KEY_PASSWORD.
#
# Versions: <major>.<minor> from package.json, and the build number as the patch: the number of commits on the
# branch (it only grows on main, so every APK installs over the previous one) — override with
# ALEXA_CLI_BUILD_NUMBER. The APKs are named alexa-cli-<version>-<abi|universal>[-debug].apk and the app shows
# "<version> (<commit>)".
#
# Needs Node 22+, a JDK 21 and the Android SDK (ANDROID_HOME, or ~/Android/Sdk). The APK lands in dist/.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$REPO/mobile"
NODE_PROJECT="$MOBILE/www/nodejs"
TYPE=release
ABI=""

while [ $# -gt 0 ]; do
    case "$1" in
        --release) TYPE=release; shift ;;
        --debug) TYPE=debug; shift ;;
        --abi) ABI="$2"; shift 2 ;;
        -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [ -z "${JAVA_HOME:-}" ]; then
    for candidate in /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/temurin-21-jdk-amd64; do
        if [ -d "$candidate" ]; then export JAVA_HOME="$candidate"; break; fi
    done
fi
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

SERIES="$(node -p "require('$REPO/package.json').version.split('.').slice(0, 2).join('.')")"
BUILD="${ALEXA_CLI_BUILD_NUMBER:-$(git -C "$REPO" rev-list --count HEAD)}"
COMMIT="${ALEXA_CLI_COMMIT:-$(git -C "$REPO" rev-parse --short HEAD)}"
VERSION_NAME="$SERIES.$BUILD"
say "alexa-cli $VERSION_NAME ($COMMIT)"

say "web interface"
npm --prefix "$REPO" run --silent ui:build

say "embedded Node.js project"
rm -rf "$MOBILE/www"
mkdir -p "$NODE_PROJECT/app/interface/app"
cp "$MOBILE/src/loader.html" "$MOBILE/www/index.html"
cp "$MOBILE/src/main.cjs" "$NODE_PROJECT/main.cjs"
printf '{\n  "name": "alexa-cli-node",\n  "private": true,\n  "main": "main.cjs"\n}\n' > "$NODE_PROJECT/package.json"
# The app is the CLI and the interface server as they are in the repo, with the built page and production
# dependencies only: no tests, no build tools.
cp -r "$REPO/src" "$NODE_PROJECT/app/src"
mkdir -p "$NODE_PROJECT/app/interface"
cp -r "$REPO/interface/server" "$NODE_PROJECT/app/interface/server"
cp -r "$REPO/interface/app/dist" "$NODE_PROJECT/app/interface/app/dist"
cp "$REPO/package.json" "$REPO/package-lock.json" "$NODE_PROJECT/app/"
# What src/version.js reads: the CLI's --version, the page and the journal say which build is running.
printf '{\n  "version": "%s",\n  "build": %s,\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' "$VERSION_NAME" "$BUILD" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$NODE_PROJECT/app/build.json"
npm --prefix "$NODE_PROJECT/app" ci --omit=dev --no-audit --no-fund --ignore-scripts
du -sh "$NODE_PROJECT" | sed 's/^/size: /'

say "Capacitor"
cd "$MOBILE"
npm ci --no-audit --no-fund
[ -d "$MOBILE/android" ] || npx cap add android
npx cap sync android

say "Gradle ($TYPE${ABI:+, $ABI})"
cd "$MOBILE/android"
GRADLE_ARGS=("-PalexaBuild=$BUILD" "-PalexaVersionName=$VERSION_NAME ($COMMIT)")
if [ -n "$ABI" ]; then GRADLE_ARGS+=("-PalexaAbi=$ABI"); fi
TASK="assemble${TYPE^}"
./gradlew --no-daemon "${GRADLE_ARGS[@]}" "$TASK"

mkdir -p "$REPO/dist"
SUFFIX=""
if [ "$TYPE" = debug ]; then SUFFIX="-debug"; fi
OUTPUTS="app/build/outputs/apk/$TYPE"
if [ -n "$ABI" ]; then
    cp "$OUTPUTS/app-$TYPE.apk" "$REPO/dist/alexa-cli-$VERSION_NAME-$ABI$SUFFIX.apk"
else
    for variant in universal arm64-v8a armeabi-v7a x86_64; do
        cp "$OUTPUTS/app-$variant-$TYPE.apk" "$REPO/dist/alexa-cli-$VERSION_NAME-$variant$SUFFIX.apk"
    done
fi
say "done"
ls -la "$REPO/dist/alexa-cli-$VERSION_NAME-"*
