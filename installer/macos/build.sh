#!/bin/bash
# Medium Latens: gera o instalador do macOS a partir do commit atual.
set -euo pipefail
export COPYFILE_DISABLE=1

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
VERSAO="${1:-$(tr -d '[:space:]' < "$RAIZ/VERSION")}"
DIST="${MEDIUM_LATENS_DIST:-$RAIZ/dist}"
STAGE="$(mktemp -d -t medium-latens-build)"
trap 'rm -rf "$STAGE"' EXIT

APP="$STAGE/root/Applications/Medium Latens"
LAUNCHER="$STAGE/root/Applications/Medium Latens.app"
mkdir -p "$APP" "$DIST"

git -C "$RAIZ" archive --format=tar HEAD | tar -x -C "$APP"
rm -rf "$APP/test" "$APP/dist" "$APP/installer/windows" "$APP/test.sh" "$APP/install-panel.sh"
rm -rf "$APP/windows" "$APP/installer/bootstrap.ps1" "$APP/installer/desinstalar.ps1" "$APP/installer/macos/build.sh" "$APP/.gitignore"
# O item aberto 4 da spec mantém o Remotion opcional; a P3 não o distribui.
rm -rf "$APP/remotion"
# Carimbo de build oficial: só existe dentro do pacote, nunca num checkout do fonte (lib/build.js).
COMMIT="$(git -C "$RAIZ" rev-parse --short HEAD)"
printf '{"oficial": true, "data": "%s", "commit": "%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMMIT" > "$APP/BUILD"

mkdir -p "$LAUNCHER/Contents/MacOS" "$LAUNCHER/Contents/Resources"
cat > "$LAUNCHER/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.brunocorrea.mediumlatens.status</string>
  <key>CFBundleName</key>
  <string>Medium Latens</string>
  <key>CFBundleExecutable</key>
  <string>abrir</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSAO</string>
  <key>CFBundleVersion</key>
  <string>$VERSAO</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST
cat > "$LAUNCHER/Contents/MacOS/abrir" <<'LAUNCHER_SCRIPT'
#!/bin/bash
exec /bin/bash "/Applications/Medium Latens/status/abrir.sh"
LAUNCHER_SCRIPT
chmod +x "$LAUNCHER/Contents/MacOS/abrir"
cp "$APP/assets/icon/icon.icns" "$LAUNCHER/Contents/Resources/icon.icns"

xattr -cr "$STAGE/root" || true

COMPONENTES="$STAGE/componentes.plist"
pkgbuild --analyze --root "$STAGE/root" "$COMPONENTES"
INDICE=0
APP_ENCONTRADO=0
while CAMINHO_BUNDLE="$(plutil -extract "$INDICE.RootRelativeBundlePath" raw "$COMPONENTES" 2>/dev/null)"; do
  if [ "$CAMINHO_BUNDLE" = "Applications/Medium Latens.app" ]; then
    plutil -replace "$INDICE.BundleIsRelocatable" -bool false "$COMPONENTES"
    plutil -replace "$INDICE.BundleIsVersionChecked" -bool false "$COMPONENTES"
    APP_ENCONTRADO=1
  fi
  INDICE=$((INDICE + 1))
done
if [ "$APP_ENCONTRADO" -ne 1 ]; then
  echo "erro: componente Medium Latens.app não encontrado" >&2
  exit 1
fi

pkgbuild --root "$STAGE/root" --component-plist "$COMPONENTES" --identifier com.brunocorrea.mediumlatens --version "$VERSAO" --scripts "$RAIZ/installer/macos/scripts" --install-location / "$STAGE/base.pkg"

BASE_PKG="$STAGE/base.pkg"
BASE_EXPANDED="$STAGE/base-expanded"
pkgutil --expand "$BASE_PKG" "$BASE_EXPANDED"
sed -E -i '' 's/(<postinstall [^>]*timeout=")[0-9]+"/\17200"/' "$BASE_EXPANDED/PackageInfo"
if ! grep -q 'timeout="7200"' "$BASE_EXPANDED/PackageInfo"; then
  echo "erro: timeout do postinstall não foi atualizado" >&2
  exit 1
fi
pkgutil --flatten "$BASE_EXPANDED" "$STAGE/base-patched.pkg"
BASE_PKG="$STAGE/base-patched.pkg"

mkdir -p "$STAGE/recursos"
cp "$RAIZ/TERMOS.md" "$STAGE/recursos/TERMOS.txt"
productbuild --synthesize --package "$BASE_PKG" "$STAGE/distribution.xml"
sed -i '' '/<installer-gui-script[^>]*>/a\
    <title>Medium Latens</title>\
    <license file="TERMOS.txt" mime-type="text/plain"/>
' "$STAGE/distribution.xml"
productbuild --distribution "$STAGE/distribution.xml" --resources "$STAGE/recursos" --package-path "$STAGE" "$DIST/Medium-Latens-$VERSAO.pkg"
echo "Gerado: $DIST/Medium-Latens-$VERSAO.pkg"
