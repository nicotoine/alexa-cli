#!/usr/bin/env bash
# Installs alexa-cli for the current user.
#
# Checks Node, installs the dependencies, links `alexa-cli` into a directory on your PATH and sets up shell
# completion. Non-blocking: a failing step is recorded and the run goes on, so a broken completion never stops the
# CLI from installing. A summary is printed at the end; the exit code is the number of failed steps.
#
# Usage:
#   ./install.sh                     # install (or update) into ~/.local/bin, completion for $SHELL
#   ./install.sh --bin-dir ~/bin     # link somewhere else
#   ./install.sh --shell zsh         # completion for another shell
#   ./install.sh --no-completion     # skip the completion step
#   ./install.sh --uninstall         # remove the link and the completion (the Amazon session is kept)
#
# Nothing here signs you in: run `alexa-cli login` afterwards.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
SHELL_NAME="$(basename "${SHELL:-bash}")"
COMPLETION=1
UNINSTALL=0
MIN_NODE=22

while [ $# -gt 0 ]; do
    case "$1" in
        --bin-dir) BIN_DIR="$2"; shift 2 ;;
        --shell) SHELL_NAME="$2"; shift 2 ;;
        --no-completion) COMPLETION=0; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
done

if [ -t 1 ]; then ok=$'\e[32m✔\e[0m'; ko=$'\e[31m✘\e[0m'; skip=$'\e[2m–\e[0m'; else ok='ok'; ko='FAIL'; skip='skip'; fi
REPORT=()
FAILED=0
step() {
    local name="$1"; shift
    local log
    if log="$("$@" 2>&1)"; then
        REPORT+=("$ok $name")
    else
        REPORT+=("$ko $name"$'\n'"$(printf '%s\n' "$log" | tail -n 5 | sed 's/^/      /')")
        FAILED=$((FAILED + 1))
    fi
}
skipped() { REPORT+=("$skip $1"); }

check_node() {
    command -v node >/dev/null || { echo "node is not installed (Node $MIN_NODE or newer is needed)"; return 1; }
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    [ "$major" -ge "$MIN_NODE" ] || { echo "Node $major found, $MIN_NODE or newer is needed"; return 1; }
}

install_dependencies() {
    cd "$REPO" && npm ci --omit=dev --no-audit --no-fund
}

link_bin() {
    mkdir -p "$BIN_DIR" && chmod +x "$REPO/bin/alexa-cli.js" && ln -sfn "$REPO/bin/alexa-cli.js" "$BIN_DIR/alexa-cli"
    case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *) echo "note: $BIN_DIR is not on your PATH" ;;
    esac
}

unlink_bin() {
    if [ -L "$BIN_DIR/alexa-cli" ]; then rm "$BIN_DIR/alexa-cli"; fi
}

if [ "$UNINSTALL" = 1 ]; then
    step "remove $BIN_DIR/alexa-cli" unlink_bin
    step "remove shell completion" "$REPO/install-completion.sh" --uninstall "$SHELL_NAME"
else
    step "Node $MIN_NODE or newer" check_node
    if [ "$FAILED" = 0 ]; then
        step "dependencies (npm ci)" install_dependencies
        step "link $BIN_DIR/alexa-cli" link_bin
        if [ "$COMPLETION" = 1 ]; then
            step "shell completion ($SHELL_NAME)" "$REPO/install-completion.sh" "$SHELL_NAME"
        else
            skipped "shell completion (--no-completion)"
        fi
    fi
fi

echo
echo "alexa-cli install report"
printf '  %s\n' "${REPORT[@]}"
if [ "$UNINSTALL" = 0 ] && [ "$FAILED" = 0 ]; then
    echo
    echo "Next: alexa-cli login        (then: alexa-cli routines, or npm run ui for the web interface)"
fi
exit "$FAILED"
