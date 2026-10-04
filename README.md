# Supjav Stremio Addon

Addon Stremio untuk streaming video dari [supjav.com](https://supjav.com).

## Fitur

- **Catalog** — Menampilkan video terbaru di halaman utama.
- **Search** — Mencari video (lama & baru) melalui `https://supjav.com/?s={query}`.
- **Meta** — Menampilkan detail video: judul, deskripsi, poster, maker, cast, dan tags.
- **Stream** — Mengekstrak link pemutaran dari tombol server (FST, VOE, dll.) dan mengurutkan berdasarkan kualitas.

## Cara Menjalankan Secara Lokal

### 1. Prasyarat

- Node.js v16 atau lebih baru
- npm

### 2. Instalasi

```bash
mkdir supjav-stremio-addon
cd supjav-stremio-addon
# Buat package.json dan index.js sesuai kode di atas
npm install