# Panduan Rilis & Build Online GunyDrive Mobile (Expo Dashboard & GitHub Releases)

Dokumen ini memandu proses build online aplikasi **Android & iOS** di **Expo Dashboard (EAS Build)** serta publikasi ke **GitHub Releases** agar fitur **Auto-Update langsung dari dalam aplikasi** berjalan konsisten.

---

## 1. Profil Build EAS (`eas.json`)

File [eas.json](eas.json) menggunakan `cli.appVersionSource: "remote"` agar server EAS mengelola dan menaikkan `android.versionCode` serta `ios.buildNumber` secara otomatis saat Anda memicu build online dari GitHub.

| Profil | Platform | Output | Environment EAS | Kegunaan |
| --- | --- | --- | --- | --- |
| `development` | Android & iOS | `.apk` / Dev Client | `development` | Pengembangan lokal dengan modul native (`GunyDeviceCatalog`, SQLite, Video). |
| `preview` | Android & iOS | `.apk` / Ad-Hoc `.ipa` | `preview` | Uji coba internal/QA (`autoIncrement: true`). |
| `production-apk` | **Android** | **`.apk` (Signed Production Keystore)** | `production` | **Khusus rilis GitHub Releases Auto-Update.** Mewarisi `production` (`autoIncrement: true` + Production Keystore) agar pembaruan *in-place* di Android selalu berhasil. |
| `production` | **Android & iOS** | Android `.aab` & iOS `.ipa` | `production` | Rilis resmi ke **Google Play Store** (`.aab`) dan **Apple TestFlight / App Store** (`.ipa`). |

---

## 2. Pengaturan Satu Kali di Expo Dashboard

1. **Hubungkan GitHub:** Di [expo.dev/settings](https://expo.dev/settings) → **Connections → GitHub**, pasang **Expo GitHub App** untuk `hendra-it19/Guny-Drive-Mobile`.
2. **Hubungkan Repositori Proyek:** Di proyek Expo (`slug: guny-drive-mobile`) → **Project Settings → GitHub**, hubungkan `hendra-it19/Guny-Drive-Mobile` dengan **Base directory** = `/` (jika memakai repo induk `hendra-it19/Guny-Drive`, isi **Base directory** = `guny-drive-mobile`).
3. **Project ID:** Jalankan `npx eas-cli init` sekali atau tambahkan `expo.owner` dan `expo.extra.eas.projectId` ke [app.json](app.json), lalu commit & push.
4. **Environment Variables (Expo Dashboard → Environment Variables):**
   - `EXPO_PUBLIC_SERVER_URL` (`production`, Plain text) = `https://drive.domainanda.com` *(wajib HTTPS, tanpa `/api/v1`)*.
   - `EXPO_PUBLIC_SERVER_URL` (`preview`, Plain text) = `https://staging-drive.domainanda.com`.
   - `EXPO_PUBLIC_GITHUB_REPO` *(opsional)* = `hendra-it19/Guny-Drive-Mobile` *(default sudah otomatis mengecek `hendra-it19/Guny-Drive-Mobile` dan `hendra-it19/Guny-Drive`)*.
5. **Kredensial:**
   - **Android:** Biarkan EAS mengelola Production Keystore untuk `com.gunydrive.mobile` (unduh backup keystore setelah build pertama).
   - **iOS:** Hubungkan akun Apple Developer / App Store Connect API Key di **Project → Credentials → iOS**. Export compliance (`usesNonExemptEncryption: false`), Face ID (`expo-local-authentication`), Background Task (`expo-background-task`), dan Video PiP (`expo-video`) sudah dikonfigurasi di [app.json](app.json).

---

## 3. Langkah Rilis Baru (Sistematis)

### Langkah 1 — Naikkan Versi & Verifikasi
1. Naikkan `"version"` di [app.json](app.json) (contoh: `"1.0.0"` → `"1.1.0"`).
2. Jalankan pemeriksaan lokal:
   ```sh
   npx tsc --noEmit
   npm run lint
   npx expo-doctor
   ```
3. Commit dan push ke branch `main`.

### Langkah 2 — Build Online di Expo Dashboard
1. Buka proyek di [Expo Dashboard](https://expo.dev) → **Builds** → **Build from GitHub**.
2. Jalankan build sesuai target:
   - **Android APK untuk GitHub Releases:** Git ref `main` · Platform `Android` · Profile **`production-apk`**
   - **Android AAB untuk Play Store:** Git ref `main` · Platform `Android` · Profile **`production`**
   - **iOS untuk TestFlight / App Store:** Git ref `main` · Platform `iOS` · Profile **`production`**
3. Setelah build `production-apk` berstatus **Finished**, unduh berkas `.apk` dan beri nama yang jelas (contoh: `GunyDrive-v1.1.0-android.apk`).

### Langkah 3 — Publikasikan GitHub Release (Memicu Auto-Update)
1. Buka [GitHub Releases](https://github.com/hendra-it19/Guny-Drive-Mobile/releases) → **Draft a new release**.
2. Buat tag semver yang cocok dengan `app.json` (contoh: **`v1.1.0`**) pada target `main`.
3. Isi judul rilis (mis. `GunyDrive v1.1.0`) dan catatan perubahan (*Release notes* akan muncul langsung di modal pembaruan aplikasi).
4. Lampirkan berkas **`.apk`** hasil profil `production-apk` pada bagian **Assets**.
5. Pastikan **bukan Draft** dan **bukan Pre-release**, centang **Set as the latest release**, lalu klik **Publish release**.

### Langkah 4 — Verifikasi pada Perangkat
1. Buka GunyDrive versi lama di Android, tunggu ~5 detik atau cek manual di **Pengaturan → Pembaruan Aplikasi (GitHub) → Periksa**.
2. Pastikan notifikasi lonceng & modal update tampil (`v1.0.0 → v1.1.0`), lalu ketuk **Unduh & Pasang Langsung**.
3. Jika Android meminta izin *"Izinkan dari sumber ini"* pertama kali, aktifkan lalu kembali dan ketuk **Pasang Sekarang**.
4. Pastikan update terpasang *in-place* tanpa menghapus login dan data SQLite lokal.

> Panduan rilis lengkap lintas backend + mobile juga tersedia di [Release.md](../Release.md) pada repositori induk.
