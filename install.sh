#!/usr/bin/env sh
# PlainScript Standalone Binary Installer (Linux & macOS)
# Installs zero-dependency precompiled plainscript executable.
set -e

REPO="ayoistooslick/plainscript"
INSTALL_DIR="/usr/local/bin"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)
    case "$ARCH" in
      x86_64*)  BIN_NAME="plainscript-linux-x64" ;;
      aarch64*|arm64*) BIN_NAME="plainscript-linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Darwin*)
    case "$ARCH" in
      x86_64*)  BIN_NAME="plainscript-macos-x64" ;;
      arm64*)   BIN_NAME="plainscript-macos-arm64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS. For Windows, please run install.ps1 in PowerShell."
    exit 1
    ;;
esac

echo "Fetching latest PlainScript release..."
TAG=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$TAG" ]; then
  TAG="v1.1.0"
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$BIN_NAME"
TMP_DEST="/tmp/plainscript"

echo "Downloading PlainScript ($TAG) for $OS ($ARCH)..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DEST"
chmod +x "$TMP_DEST"

# Determine target directory
if [ -w "$INSTALL_DIR" ]; then
  DEST="$INSTALL_DIR/plainscript"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  DEST="$INSTALL_DIR/plainscript"
fi

mv "$TMP_DEST" "$DEST"
echo "✓ Installed PlainScript to $DEST"

if ! command -v plainscript >/dev/null 2>&1; then
  echo ""
  echo "Note: Make sure $INSTALL_DIR is in your PATH."
  echo "Add the following to your ~/.bashrc or ~/.zshrc:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

echo ""
echo "PlainScript is ready! Try:"
echo "  plainscript version"
echo "  plainscript new my-app"
