#!/usr/bin/env bash
# Builds the Android app: the web interface and alexa-cli in one APK, with Node.js embedded (nodejs-mobile, through
# the capacitor-nodejs plugin). The phone runs the same CLI and interface server as a computer, in-process.
#
# Usage:
#   scripts/build-apk.sh                 # debug APK (signed with the debug key: installs anywhere, for testing)
#   scripts/build-apk.sh --release       # release APK, signed with the key given in the environment:
#        ALEXA_CLI_KEYSTORE (path), ALEXA_CLI_KEYSTORE_PASSWORD, ALEXA_CLI_KEY_ALIAS, ALEXA_CLI_KEY_PASSWORD
#   scripts/build-apk.sh --abi arm64-v8a # one architecture only (a smaller APK for a recent phone)
#
# Needs Node 22+, a JDK 21 and the Android SDK (ANDROID_HOME, or ~/Android/Sdk). The APK lands in dist/.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$REPO/mobile"
NODE_PROJECT="$MOBILE/www/nodejs"
TYPE=debug
ABI=""

while [ $# -gt 0 ]; do
    case "$1" in
        --release) TYPE=release; shift ;;
        --abi) ABI="$2"; shift 2 ;;
        -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
npm --prefix "$NODE_PROJECT/app" ci --omit=dev --no-audit --no-fund --ignore-scripts
du -sh "$NODE_PROJECT" | sed 's/^/size: /'

say "Capacitor"
cd "$MOBILE"
npm ci --no-audit --no-fund
[ -d "$MOBILE/android" ] || npx cap add android
npx cap sync android

say "Gradle ($TYPE${ABI:+, $ABI})"
cd "$MOBILE/android"
GRADLE_ARGS=()
if [ -n "$ABI" ]; then GRADLE_ARGS+=("-PalexaAbi=$ABI"); fi
if [ "$TYPE" = release ]; then
    : "${ALEXA_CLI_KEYSTORE:?set ALEXA_CLI_KEYSTORE (and the passwords) for a release build}"
    ./gradlew --no-daemon "${GRADLE_ARGS[@]}" assembleRelease
    APK="app/build/outputs/apk/release/app-release.apk"
else
    ./gradlew --no-daemon "${GRADLE_ARGS[@]}" assembleDebug
    APK="app/build/outputs/apk/debug/app-debug.apk"
fi

VERSION="$(node -p "require('$REPO/package.json').version")"
mkdir -p "$REPO/dist"
OUT="$REPO/dist/alexa-cli-$VERSION-$TYPE${ABI:+-$ABI}.apk"
cp "$APK" "$OUT"
say "done"
ls -la "$OUT"
