# Tix48 Firefox Add-on — Infeasible Features

Daftar fitur yang **tidak mungkin diimplementasikan** pada project ini beserta alasannya.

---

## 🔴 Tidak Mungkin (Technical Limitation)

### 1. Full Screen Mode
**Alasan:** Firefox extension popup adalah temporary window.
- Popup menutup saat klik di luar
- Fullscreen API tidak berfungsi di popup context
- Tidak ada cara membuat popup fullscreen

### 2. Queue Position Tracker (#10)
**Alasan:** Bergantung pada implementasi Cloudflare Waiting Room.
- CF Waiting Room bisa berubah sewaktu-waktu
- Tidak ada API publik untuk posisi antrian
- Mekanisme antrian dienkripsi di sisi server

### 3. WebSocket Real-time (#49)
**Alasan:** jkt48.com tidak menyediakan WebSocket endpoint.
- API hanya REST endpoint
- Tidak ada push notification dari server
- Harus tetap polling

### 4. Seat Map Integration (#3)
**Alasan:** Data peta tempat duduk tidak tersedia di API.
- API hanya mengembalikan data jalur
- Tidak ada koordinat seat
- Layout theater bisa berubah

### 5. Biometric Unlock (#71)
**Alasan:** Firefox extension tidak support Web Authentication API.
- Fingerprint/face hanya bisa di content script
- Tidak ada akses ke autentikasi OS
- Tidak relevan untuk extension

### 6. SMS Alert (#24)
**Alasan:** Membutuhkan layanan SMS gateway berbayar.
- Tidak ada API SMS gratis
- Biaya operasional tinggi
- User harus daftar layanan terpisah

### 7. Email Digest (#23)
**Alasan:** Membutuhkan SMTP server atau layanan email.
- Tidak ada email server tersedia
- Harus gunakan SendGrid/Mailgun (berbayar)
- Kompleksitas tinggi

### 8. Two-Factor Auth (#78)
**Alasan:** Extension tidak memiliki sistem autentikasi.
- Tidak ada user account
- Data hanya di browser storage
- 2FA tidak relevan

### 9. IP Tracking (#79)
**Alasan:** Extension tidak punya akses ke IP user.
- Browser sandbox mencegah akses IP
- Privasi user dilanggar
- Tidak ada backend untuk menyimpan

### 10. Haptic Feedback (#63)
**Alasan:** Web API tidak mendukung di desktop.
- Vibration API hanya untuk mobile
- Firefox desktop tidak support
- Tidak ada cara getar di PC

### 11. Camera Scan (#69)
**Alasan:** Membutuhkan akses kamera kompleks.
- getUserMedia butuh permission
- Barcode scanning butuh library
- Tidak relevan untuk use case

### 12. Voice Commands (#68)
**Alasan:** Web Speech API tidak reliable.
- Firefox support terbatas
- Akurasi rendah istilah spesifik
- Tidak praktis harian

### 13. WebSocket Notifications
**Alasan:** Tidak ada WebSocket server.
- jkt48.com tidak support
- Harus buat server sendiri (berbayar)
- Overkill untuk monitoring

### 14. Real-time Collaboration
**Alasan:** Tidak ada use case kolaborasi.
- Extension per-user
- Tidak ada fitur share
- Kompleksitas tinggi

### 15. Push Notifications (Web)
**Alasan:** Service Worker push membutuhkan VAPID key.
- Butuh server push sendiri
- Kompleksitas tinggi
- Cukup gunakan browser notification

---

## 🟡 Tidak Relevan (Business Logic)

### 16. Auto-Purchase
**Alasan:** Automasi pembelian melanggar ToS jkt48.com.
- Bot detection memblokir
- Risk akun dibanned
- Tidak etis

### 17. Seat Selection
**Alasan:** Extension hanya monitoring.
- Pembelian harus lewat jkt48.com
- Tidak ada integrasi payment
- Melanggar ToS jika di-automate

### 18. Account Management
**Alasan:** Tidak menyimpan kredensial login.
- Password tidak boleh disimpan
- OAuth flow kompleks
- Privasi prioritas

### 19. Payment Integration
**Alasan:** Membutuhkan izin PCI compliance.
- Biaya implementasi tinggi
- Tidak relevan untuk monitoring

### 20. Ticket Download
**Alasan:** Tiket hanya bisa diakses setelah beli.
- API tidak menyediakan endpoint
- Tiket dilindungi PDF/QR
- Hanya dari akun jkt48.com

### 21. Multi-Account Login
**Alasan:** Tidak bisa login di extension.
- Session management kompleks
- Risk keamanan
- Cukup fetch data saja

### 22. Payment Callback
**Alasan:** Tidak ada integrasi payment.
- Tidak ada webhook
- Tidak ada payment gateway
- Tidak relevan

### 23. Order Management
**Alasan:** Tidak ada sistem order.
- Extension hanya monitoring
- Tidak ada database order
- Tidak relevan

### 24. Refund Processing
**Alasan:** Tidak ada akses ke sistem pembayaran.
- Refund harus lewat jkt48.com
- Tidak ada API refund
- Tidak relevan

### 25. Invoice Generation
**Alasan:** Tidak ada sistem billing.
- Tidak ada data pembayaran
- Tidak ada nomor invoice
- Tidak relevan

---

## 🟠 Tidak Praktis (Resource Constraint)

### 26. Multi-Browser Sync (#57)
**Alasan:** Tidak ada layanan sync gratis.
- Firefox Sync hanya data browser
- Tidak ada backend sync
- Biaya server tinggi

### 27. Cloud Storage (#42)
**Alasan:** IndexedDB/localStorage sudah cukup.
- Tidak ada cloud gratis suitable
- Kompleksitas tinggi
- Data tidak perlu sync

### 28. AI/ML Features (#91-100)
**Alasan:** Butuh model ML besar.
- Tidak ada ruang di extension
- Edge computing terbatas
- Biaya inferensi tinggi

### 29. Analytics Dashboard (#50)
**Alasan:** Tidak ada tracking penggunaan.
- Privasi user prioritas
- Tidak ada monetisasi
- Overkill

### 30. Enterprise Features
**Alasan:** Untuk personal/komunitas.
- User management tidak perlu
- Audit log berlebihan
- Permission granular overkill

---

## ⚪ Overkill (Tidak Diperlukan)

### 31. A/B Testing
**Alasan:** Tidak ada fitur perlu di-test.
- UI sudah final
- User base kecil
- Kompleksitas tinggi

### 32. Rate Limiting per User
**Alasan:** Hanya 1 user.
- Tidak ada abuse
- Overkill personal use
- Cukup di API saja

### 33. Geo-blocking
**Alasan:** Tidak ada konten diblokir.
- Semua user bisa akses
- Tidak ada regulasi lokasi

### 34. GDPR Compliance
**Alasan:** Tidak ada data user dikumpulkan.
- Tidak ada database user
- Tidak ada tracking
- Tidak relevan

### 35. SOC 2 Compliance
**Alasan:** Tidak ada sistem enterprise.
- Tidak ada audit trail
- Tidak ada access control
- Tidak relevan

---

## 📋 Status Implementasi Terakhir

### Sudah Dihapus/Dibatalkan
| Fitur | Alasan Dihapus |
|-------|----------------|
| Fullscreen Mode | Tidak berfungsi di popup |
| Heatmap View | Mengganggu tampilan |
| Calendar View (terpisah) | Digabung ke date quick-jump |

### Sudah Diimplementasi
| Fitur | Versi |
|-------|-------|
| Cover Photo | v2.0 |
| Revenue Stats | v2.0 |
| Transaction History | v2.0 |
| Calendar Sync (.ics) | v2.1 |
| Mini Mode | v2.1 |
| Flash Alert | v2.1 |
| Delta Updates | v2.1 |
| Reset Settings | v2.1 |

---

## Ringkasan

| Kategori | Jumlah |
|----------|--------|
| 🔴 Technical Limitation | 15 |
| 🟡 Business Logic | 10 |
| 🟠 Resource Constraint | 5 |
| ⚪ Overkill | 5 |
| **Total** | **35** |

---

*Terakhir diupdate: 28 Agustus 2026*
