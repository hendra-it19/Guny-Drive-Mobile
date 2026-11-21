# GunyDrive Mobile

Aplikasi mobile Android & iOS berbasis **Expo SDK 58**, **React Native 0.88**, **TypeScript**, dan **Expo Router**. Terhubung ke backend Laravel GunyDrive melalui HTTPS, memakai **SQLite lokal** untuk katalog perangkat, antrean resumable, dan riwayat worker, serta **SecureStore** untuk kredensial perangkat.

- Repositori Mobile: [hendra-it19/Guny-Drive-Mobile](https://github.com/hendra-it19/Guny-Drive-Mobile)
- Repositori Induk: [hendra-it19/Guny-Drive](https://github.com/hendra-it19/Guny-Drive)

---

## Fitur Utama

| Tab / Layar | Fitur |
| --- | --- |
| **Berkas** | Terdiri dari **Sistem HP** (katalog lokal tersimpan di SQLite + *delta scan* instan tanpa scan ulang berat, *multi-select* upload langsung tanpa salinan ganda) dan **Cloud Server** (*file manager* lengkap: *multi-select*, salin, potong, tempel, ubah nama, buat/hapus folder, *infinite scroll*). |
| **File** | Galeri terpadu hasil backup (**Semua**, **Foto**, **Video**, **Dokumen**) dengan tata letak Daftar / Grid 2 / Grid 3 / Grid 4, pengurutan, pemutar video/audio native, dan pembaca berkas online. |
| **Privat** | Folder Privat ber-PIN yang terpisah dari berkas biasa, terkunci otomatis saat aplikasi ke latar atau diam 5 menit. |
| **Pengaturan** | Ringkasan akun & kuota, kontrol backup otomatis (**Foto**, **Video**, **Dokumen**, **Audio**), jadwal latar belakang harian **00:00 (12 malam)**, opsi **Backup Otomatis Berkas Baru** (mode ala Google Foto, mati secara default), **Passkey Biometrik**, **Tema 5×2**, **Sampah Explorer**, Log & Diagnostik, **Pembaruan Aplikasi (GitHub)**, dan **Logout**. |
| **Sampah** | Tampilan bergaya *file explorer* dengan pratinjau file, grid/list, sorting, pencarian, filter kategori, *multi-select*, pulihkan, dan hapus permanen (retensi 30 hari). |

### Thumbnail Cerdas (Ringan & Cepat)
- **Dokumen & Non-Media** (`PDF`, `Word`, `Excel`, `PowerPoint`, `Text`, `Code`, `Audio`, `Archive`, `File`) dirender langsung memakai komponen vektor native [DefaultFileThumbnail.tsx](src/components/ui/DefaultFileThumbnail.tsx) tanpa request jaringan.
- **Foto & Video** menampilkan thumbnail teroptimasi `≤ 320px` (WebP/JPEG dari server atau thumbnail lokal Android/iOS), sedangkan berkas asli hanya diunduh saat pengguna membuka pratinjau penuh atau menyimpan berkas.

### Deteksi & Pembaruan Otomatis via GitHub Releases
Aplikasi yang sudah terpasang dapat mendeteksi rilis terbaru secara otomatis dari GitHub Releases dan memperbarui aplikasi langsung dari dalam aplikasi:

- **Deteksi Otomatis**: Memeriksa rilis terbaru secara otomatis di latar belakang setelah aplikasi terbuka (dengan *throttle* 3 jam) maupun secara manual lewat **Pengaturan → Pembaruan Aplikasi (GitHub)**.
- **Notifikasi & Modal Pembaruan**: Menampilkan pemberitahuan di ikon Lonceng Notifikasi dan modal [AppUpdateModal.tsx](src/components/ui/AppUpdateModal.tsx) yang memuat versi lama → baru, catatan rilis, ukuran APK, opsi *Lewati Versi Ini*, dan tombol pembaruan.
- **Unduh & Pasang Langsung (Android)**:
  - Mengunduh aset `.apk` langsung ke cache lokal dengan bilah progres waktu nyata (*streaming* ke disk via `expo-file-system`).
  - Memicu pemasang sistem Android melalui modul native `GunyDeviceCatalog` ([DeviceCatalogModule.kt](modules/device-catalog/android/src/main/java/com/gunydrive/catalog/DeviceCatalogModule.kt) + `UpdateFileProvider` + izin `REQUEST_INSTALL_PACKAGES`). Jika izin instalasi dari sumber tidak dikenal belum aktif, aplikasi mengarahkan pengguna langsung ke pengaturan izin tersebut lalu melanjutkan instalasi tanpa mengunduh ulang.
  - Pada iOS / Web / rilis tanpa `.apk`, aplikasi membuka halaman GitHub Release terkait.
- **Konfigurasi Sumber Rilis**: Secara bawaan memeriksa `hendra-it19/Guny-Drive-Mobile` dan `hendra-it19/Guny-Drive` (dikonfigurasi di `extra.githubReleaseRepos` pada [app.json](app.json), dan dapat dioverride dengan variabel lingkungan `EXPO_PUBLIC_GITHUB_REPO=owner/repo`).

---

## Menjalankan & Membangun Aplikasi

1. Siapkan **Node.js 22.18+**, **npm**, serta [backend Laravel](../guny-drive-backend/README.md) yang dapat diakses ponsel melalui HTTPS.
2. Pasang dependensi:

```sh
npm ci
```

3. Tetapkan URL HTTPS server backend pada variabel `EXPO_PUBLIC_SERVER_URL` atau `DEPLOYED_SERVER_URL` di [src/lib/api.ts](src/lib/api.ts) (tanpa akhiran `/api/v1`).
4. Bangun development / preview / release build (disarankan karena menyertakan modul native SQLite, `GunyDeviceCatalog`, pemutar video, dan pemasang APK):

```sh
# Development build Android (APK)
npx eas-cli build --profile development --platform android

# Preview / Release APK untuk dibagikan di GitHub Releases
npx eas-cli build --profile preview --platform android

# Jalankan Metro server untuk development build
npx expo start --dev-client
```

### Cara Merilis Pembaruan ke GitHub Releases
1. Naikkan nomor versi semver di [app.json](app.json) (contoh: `"version": "1.1.0"`).
2. Bangun APK rilis baru.
3. Buat **Release** baru di GitHub dengan tag semver yang cocok (misalnya `v1.1.0`), isi catatan perubahan, dan lampirkan berkas `.apk` pada **Assets**.
4. Aplikasi yang sudah terpasang di perangkat pengguna akan otomatis mendeteksi versi baru tersebut dan menawarkan tombol **Unduh & Pasang Langsung**.

---

## Pemeriksaan Kualitas

```sh
npx tsc --noEmit
npm run lint
npx expo-doctor
```

[Kontrak API v1](../docs/openapi-v1.yaml) · [Matriks Uji Perangkat](../docs/laporan-uji-rilis.md) · [Desain & Tema](../desain.md) · [Panduan Proyek Induk](../README.md)
