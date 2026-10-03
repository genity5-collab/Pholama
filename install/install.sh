#!/usr/bin/env bash
# Pholama installer for Mac and Linux. Run:
#   curl -fsSL https://raw.githubusercontent.com/genity5-collab/Pholama/main/install/install.sh | bash
set -e
# Pholama for PC is for Windows, Mac and Linux computers. Refuse phones (Android via Termux) so it is never installed by accident.
if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ] || uname -a | grep -qi android; then
  printf '\n  Pholama for PC is for computers, not phones. On your phone just open the Pholama website.\n\n'; exit 1
fi
DIR="$HOME/Pholama"; TAR="https://github.com/genity5-collab/Pholama/archive/refs/heads/main.tar.gz"
say() { printf '\n  %s\n' "$1"; }
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  say "Node.js 18 or newer is needed. Get it from https://nodejs.org (or: brew install node), then run this again."; exit 1
fi
command -v curl >/dev/null 2>&1 || { say "curl is needed."; exit 1; }
command -v tar >/dev/null 2>&1 || { say "tar is needed."; exit 1; }
say "Downloading Pholama to $DIR ..."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$TAR" -o "$TMP/p.tgz"; tar -xzf "$TMP/p.tgz" -C "$TMP"
mkdir -p "$DIR"; cp -R "$TMP"/Pholama-main/. "$DIR"/
chmod +x "$DIR/start.sh" "$DIR/server/server.js"
# make the pholama command available
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexec node "%s/server/cli.js" "$@"\n' "$DIR" > "$HOME/.local/bin/pholama"; chmod +x "$HOME/.local/bin/pholama"
cp "$HOME/.local/bin/pholama" "$HOME/.local/bin/phollama" 2>/dev/null || true
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "Add this to your shell profile so the pholama command works everywhere:  export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac
say "Installed. Try:  pholama list     then:  pholama pull qwen2.5-0.5b"
say "Or open the app:  pholama web"
node "$DIR/server/cli.js" web || true
