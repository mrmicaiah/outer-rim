#!/bin/bash
# Build Perimeter's macOS .icns icon from source.
# Run once from the perimeter/ directory:  bash assets/build-icon.sh

set -e
cd "$(dirname "$0")"

if [ ! -f icon.png ]; then
  if ! python3 -c "import PIL" 2>/dev/null; then
    echo "Installing Pillow..."
    pip3 install --user Pillow
  fi
  python3 generate-icon.py
fi

rm -rf icon.iconset
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png       > /dev/null
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png    > /dev/null
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png       > /dev/null
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png    > /dev/null
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png     > /dev/null
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png  > /dev/null
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png     > /dev/null
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png  > /dev/null
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png     > /dev/null
cp icon.png       icon.iconset/icon_512x512@2x.png

iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset

echo "Built $(pwd)/icon.icns"
