# Tix48 Firefox Add-on Icons

This directory needs two icon files:

- `icon-48.png` — 48×48 pixels (toolbar icon)
- `icon-96.png` — 96×96 pixels (add-ons manager)

## Cara Membuat Icon

### Opsi 1: Gunakan icon dari project web
Copy `public/tix48.png` dan resize:
```bash
# Dari root project
cp public/tix48.png add-on/icons/icon-48.png
cp public/tix48.png add-on/icons/icon-96.png
```

### Opsi 2: Buat icon baru
Buat icon PNG dengan background merah (#dc2626) dan huruf "T" putih tebal.

### Opsi 3: Gunakan placeholder
Jika tidak ada icon, extension tetap bisa jalan — Firefox akan
menggunakan icon default (puzzle piece).

## Format yang Didukung
- PNG (disarankan)
- SVG (Manifest V2, untuk browser_action icon)
