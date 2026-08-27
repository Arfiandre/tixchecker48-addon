/**
 * Tix48 — Content Script for jkt48.com
 *
 * Menampilkan tombol floating "Check Tix" di pojok kanan bawah
 * saat user mengakses website jkt48.com.
 *
 * Fitur:
 *   - Deteksi kode exclusive dari URL atau halaman
 *   - Klik tombol → buka popup extension dengan kode otomatis
 *   - Hover tooltip menampilkan kode yang terdeteksi
 */

(function () {
  "use strict";

  // Cegah duplicate injection
  if (document.getElementById("tix48-fab")) return;

  // ── Deteksi kode dari URL ──
  function detectCode() {
    const url = window.location.href;

    // Pattern 1: /exclusive/EX1A2B atau /purchase/exclusive?code=EX1A2B
    const urlMatch = url.match(/(?:\/exclusive\/|code=)(EX[A-Z0-9]{4})/i);
    if (urlMatch) return urlMatch[1].toUpperCase();

    // Pattern 2: Cari di halaman (link, teks, dll)
    const codeRegex = /\bEX[A-Z0-9]{4}\b/g;
    const bodyText = document.body?.innerText || "";
    const bodyMatch = bodyText.match(codeRegex);
    if (bodyMatch && bodyMatch.length > 0) {
      // Ambil kode yang paling sering muncul
      const counts = {};
      for (const code of bodyMatch) {
        counts[code] = (counts[code] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) return sorted[0][0];
    }

    // Pattern 3: Cari di data attributes
    const dataElements = document.querySelectorAll("[data-code], [data-exclusive]");
    for (const el of dataElements) {
      const code = (el.dataset.code || el.dataset.exclusive || "").toUpperCase();
      if (/^EX[A-Z0-9]{4}$/.test(code)) return code;
    }

    return null;
  }

  // ── Buat tombol floating ──
  function createButton() {
    const fab = document.createElement("div");
    fab.id = "tix48-fab";
    fab.innerHTML = `
      <style>
        #tix48-fab {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }
        #tix48-fab-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          background: #dc2626;
          color: white;
          border: none;
          border-radius: 50px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(220, 38, 38, 0.4);
          transition: all 0.2s ease;
          text-decoration: none;
          white-space: nowrap;
        }
        #tix48-fab-btn:hover {
          background: #b91c1c;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(220, 38, 38, 0.5);
        }
        #tix48-fab-btn:active {
          transform: translateY(0);
        }
        #tix48-fab-btn .fab-icon {
          font-size: 18px;
        }
        #tix48-fab-tooltip {
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 8px;
          padding: 6px 12px;
          background: #1e293b;
          color: #f1f5f9;
          border-radius: 6px;
          font-size: 11px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        #tix48-fab-tooltip::after {
          content: '';
          position: absolute;
          top: 100%;
          right: 20px;
          border: 5px solid transparent;
          border-top-color: #1e293b;
        }
        #tix48-fab:hover #tix48-fab-tooltip {
          opacity: 1;
        }
      </style>
      <div id="tix48-fab-tooltip">Masukkan kode manual</div>
      <button id="tix48-fab-btn">
        <span class="fab-icon">🎫</span>
        <span class="fab-text">Check Tix</span>
      </button>
    `;

    document.body.appendChild(fab);

    const btn = document.getElementById("tix48-fab-btn");
    const tooltip = document.getElementById("tix48-fab-tooltip");

    // Deteksi kode
    const detectedCode = detectCode();
    if (detectedCode) {
      tooltip.textContent = "Kode terdeteksi: " + detectedCode;
      btn.querySelector(".fab-text").textContent = "Check " + detectedCode;
    }

    // Klik tombol
    btn.addEventListener("click", () => {
      // Kirim pesan ke background script
      const code = detectedCode || null;
      try {
        browser.runtime.sendMessage({
          type: "OPEN_POPUP",
          code: code,
        });
      } catch (_) {
        // Fallback: buka popup langsung
        if (code) {
          browser.storage.local.set({ pendingCode: code });
        }
        browser.action.openPopup();
      }
    });

    // Animasi muncul
    fab.style.opacity = "0";
    fab.style.transform = "translateY(20px)";
    fab.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    requestAnimationFrame(() => {
      fab.style.opacity = "1";
      fab.style.transform = "translateY(0)";
    });
  }

  // ── Jalankan ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createButton);
  } else {
    createButton();
  }
})();
