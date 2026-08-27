/**
 * Tix48 — Background Service Worker (Manifest V3)
 *
 * Fitur:
 *   1. Multi-code cache (max 5 kode terakhir)
 *   2. Retry with exponential backoff
 *   3. Request queuing (cegah duplicate fetch)
 *   4. Background periodic fetch (setiap 60 detik)
 *   5. Badge counter (tampilkan jumlah tiket tersisa)
 *   6. Browser notifications (tiket menipis)
 *   7. Context menu (klik kanan → cek kode)
 *   8. Omnibox (ketik "tix" di address bar)
 *   9. Storage quota monitoring
 *  10. Stock threshold alerts
 */

const API_BASE = "https://jkt48.com/api/v1/exclusives";
const CACHE_TTL_MS = 30_000;
const MAX_CACHED_CODES = 5;
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_MAX = 3;
const RETRY_BASE_MS = 1000;
const PERIODIC_INTERVAL_MIN = 1;

// ── State ──
let memCache = new Map(); // { code → { data, ts } }
let fetchQueues = new Map(); // { code → Promise }
let activeCode = null;
let settings = {
  notifications: true,
  threshold: 5,
  periodicFetch: true,
};

// ──────────────────────────────────────────────────────────────
// Cache Management (max 5 codes)
// ──────────────────────────────────────────────────────────────

function cacheGet(code) {
  const entry = memCache.get(code);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}

function cacheSet(code, data) {
  memCache.set(code, { data, ts: Date.now() });
  // Evict oldest if over limit
  if (memCache.size > MAX_CACHED_CODES) {
    const oldest = memCache.keys().next().value;
    memCache.delete(oldest);
  }
  // Persist to storage
  try {
    const obj = {};
    memCache.forEach((v, k) => { obj[k] = v; });
    browser.storage.local.set({ tixCache: obj });
  } catch (_) {}
}

async function loadCacheFromStorage() {
  try {
    const result = await browser.storage.local.get("tixCache");
    if (result.tixCache) {
      for (const [k, v] of Object.entries(result.tixCache)) {
        if (v && v.ts && Date.now() - v.ts < CACHE_TTL_MS * 2) {
          memCache.set(k, v);
        }
      }
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────
// Fetch with Retry + Timeout
// ──────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchWithRetry(code) {
  let lastErr;
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const url = `${API_BASE}/${code}?lang=id`;
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_MAX - 1) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ──────────────────────────────────────────────────────────────
// Request Queuing (cegah duplicate fetch)
// ──────────────────────────────────────────────────────────────

async function queuedFetch(code) {
  if (fetchQueues.has(code)) return fetchQueues.get(code);

  const promise = doFetch(code).finally(() => fetchQueues.delete(code));
  fetchQueues.set(code, promise);
  return promise;
}

async function doFetch(code) {
  // Check cache first
  const cached = cacheGet(code);
  if (cached) return { ok: true, data: cached, cached: true };

  // Get previous data for comparison
  let previousData = null;
  try {
    const stored = await browser.storage.local.get(`cache_${code}`);
    previousData = stored[`cache_${code}`]?.data || null;
  } catch (_) {}

  try {
    const raw = await fetchWithRetry(code);
    const parsed = parseExclusiveData(code, raw);
    if (!parsed) return { ok: false, error: "Data tidak ditemukan." };

    // Compare and track changes
    if (previousData) {
      trackChanges(code, previousData, parsed);
    }

    cacheSet(code, parsed);
    return { ok: true, data: parsed, cached: false };
  } catch (err) {
    // Fallback to storage cache
    try {
      const stored = await browser.storage.local.get("tixCache");
      const entry = stored.tixCache?.[code];
      if (entry?.data) {
        return { ok: true, data: entry.data, cached: true, stale: true };
      }
    } catch (_) {}
    return { ok: false, error: err.message || "Gagal mengambil data." };
  }
}

// ──────────────────────────────────────────────────────────────
// Transaction History Tracking
// ──────────────────────────────────────────────────────────────

const MAX_HISTORY = 100; // Max history entries to keep

async function trackChanges(code, oldData, newData) {
  const changes = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // Build lookup maps
  const oldMap = {};
  for (const s of (oldData.sessions || [])) {
    for (const j of (s.jalur || [])) {
      const key = `${s.date}_${j.label}`;
      oldMap[key] = { member: j.member, available: j.available ?? 0, sold: j.sold ?? 0, date: s.date, session: s.label };
    }
  }

  // Compare with new data
  for (const s of (newData.sessions || [])) {
    for (const j of (s.jalur || [])) {
      const key = `${s.date}_${j.label}`;
      const old = oldMap[key];
      const newAvail = j.available ?? 0;
      const newSold = j.sold ?? 0;

      if (old) {
        const availDiff = newAvail - old.available;
        const soldDiff = newSold - old.sold;

        // Only track if there's a change
        if (availDiff !== 0 || soldDiff !== 0) {
          changes.push({
            time: timeStr,
            member: j.member || "—",
            jalur: j.label,
            session: s.label,
            date: s.date,
            oldAvail: old.available,
            newAvail: newAvail,
            oldSold: old.sold,
            newSold: newSold,
            diff: soldDiff > 0 ? soldDiff : availDiff,
            type: soldDiff > 0 ? "sold" : "available",
          });
        }
      } else if (newAvail > 0 || newSold > 0) {
        // New entry
        changes.push({
          time: timeStr,
          member: j.member || "—",
          jalur: j.label,
          session: s.label,
          date: s.date,
          oldAvail: 0,
          newAvail: newAvail,
          oldSold: 0,
          newSold: newSold,
          diff: newSold,
          type: "new",
        });
      }
    }
  }

  if (changes.length > 0) {
    await saveHistory(code, changes);
  }
}

async function saveHistory(code, newEntries) {
  try {
    const result = await browser.storage.local.get(`history_${code}`);
    let history = result[`history_${code}`] || [];
    history = [...newEntries, ...history].slice(0, MAX_HISTORY);
    await browser.storage.local.set({ [`history_${code}`]: history });
  } catch (_) {}
}

async function getHistory(code) {
  try {
    const result = await browser.storage.local.get(`history_${code}`);
    return result[`history_${code}`] || [];
  } catch (_) {
    return [];
  }
}

async function clearHistory(code) {
  try {
    await browser.storage.local.remove(`history_${code}`);
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────
// Parse API Response
// ──────────────────────────────────────────────────────────────

function parseExclusiveData(code, raw) {
  if (!raw?.status) return null;
  const data = raw.data || {};
  const now = new Date();

  const salesPeriods = (data.sales_period || []).map((sp) => {
    const endStr = sp.end || sp.end_date;
    const endDt = endStr ? new Date(endStr) : null;
    return {
      label: sp.label,
      start: sp.start || sp.start_date,
      end: endStr,
      active: endDt ? now <= endDt : false,
    };
  });

  const sessions = (data.session || []).map((sess) => ({
    label: sess.label,
    date: sess.date,
    start: sess.start_time,
    end: sess.end_time,
    jalur: (sess.session_detail || []).map((j) => ({
      label: j.label,
      member: j.jkt48_member_name,
      sold: j.tickets_sold,
      available: j.available_quota,
    })),
  }));

  let endDate = null;
  for (const lbl of ["General", "OFC"]) {
    const sp = salesPeriods.find((p) => p.label === lbl);
    if (sp?.end) { endDate = sp.end; break; }
  }

  return {
    code,
    title: (data.title || "").trim(),
    category: data.category,
    price: data.default_price ? Number(data.default_price) : null,
    thumbnail: data.thumbnail_image || data.preview_image || null,
    sessions,
    is_open: salesPeriods.some((sp) => sp.active),
    end_date: endDate,
  };
}

// ──────────────────────────────────────────────────────────────
// Badge Counter
// ──────────────────────────────────────────────────────────────

function updateBadge(data) {
  if (!data?.sessions) {
    browser.action.setBadgeText({ text: "" });
    return;
  }
  let avail = 0;
  let expired = 0;
  const nowWIB = new Date(Date.now() + 7 * 3600000);
  const todayStr = nowWIB.toISOString().slice(0, 10);

  for (const s of data.sessions) {
    const isDateExpired = s.date <= todayStr;
    for (const j of (s.jalur || [])) {
      if (isDateExpired) {
        expired += (j.available ?? 0);
      } else {
        avail += (j.available ?? 0);
      }
    }
  }

  const text = avail > 0 ? String(avail) : "0";
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({
    color: avail > 10 ? "#16a34a" : avail > 0 ? "#d97706" : "#dc2626",
  });
}

// ──────────────────────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────────────────────

async function checkAndNotify(data) {
  if (!settings.notifications || !data?.sessions) return;

  const nowWIB = new Date(Date.now() + 7 * 3600000);
  const todayStr = nowWIB.toISOString().slice(0, 10);
  let lowStock = [];

  for (const s of data.sessions) {
    if (s.date <= todayStr) continue;
    for (const j of (s.jalur || [])) {
      const avail = j.available ?? 0;
      if (avail > 0 && avail <= settings.threshold) {
        lowStock.push(`${j.member} (${j.label}) — sisa ${avail}`);
      }
    }
  }

  if (lowStock.length > 0) {
    const msg = lowStock.slice(0, 5).join("\n");
    const extra = lowStock.length > 5 ? `\n...dan ${lowStock.length - 5} lainnya` : "";
    try {
      browser.notifications.create(`tix48-low-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon.svg",
        title: "Tix48 — Tiket Menipis!",
        message: msg + extra,
        priority: 2,
      });
    } catch (_) {}
  }
}

// ──────────────────────────────────────────────────────────────
// Context Menus
// ──────────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "tix48-check",
    title: "Cek kode '%s' di Tix48",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: "tix48-page",
    title: "Buka Tix48",
    contexts: ["page", "action"],
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "tix48-check" && info.selectionText) {
    const code = info.selectionText.trim().toUpperCase();
    if (/^EX[A-Z0-9]{4}$/.test(code)) {
      openPopupWithCode(code);
    }
  }
  if (info.menuItemId === "tix48-page") {
    openPopupWithCode(null);
  }
});

function openPopupWithCode(code) {
  if (code) {
    browser.storage.local.set({ pendingCode: code });
  }
  browser.action.openPopup();
}

// ──────────────────────────────────────────────────────────────
// Omnibox
// ──────────────────────────────────────────────────────────────

browser.omnibox.onInputEntered.addListener((text) => {
  const code = text.trim().toUpperCase();
  if (/^EX[A-Z0-9]{4}$/.test(code)) {
    browser.storage.local.set({ pendingCode: code });
    browser.action.openPopup();
  }
});

browser.omnibox.onInputChanged.addListener((text, suggest) => {
  const code = text.trim().toUpperCase();
  if (/^EX[A-Z0-9]{0,4}$/.test(code) && code.length >= 2) {
    suggest([{ content: code, description: `Cek tiket <match>${code}</match>` }]);
  }
});

// ──────────────────────────────────────────────────────────────
// Message Handler
// ──────────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_EXCLUSIVE") {
    activeCode = msg.code;
    queuedFetch(msg.code).then((result) => {
      if (result.ok) {
        updateBadge(result.data);
        checkAndNotify(result.data);
      }
      sendResponse(result);
    });
    return true;
  }

  if (msg.type === "GET_CACHE") {
    const data = cacheGet(msg.code);
    sendResponse({ fresh: !!data, data });
    return false;
  }

  if (msg.type === "GET_SETTINGS") {
    sendResponse(settings);
    return false;
  }

  if (msg.type === "UPDATE_SETTINGS") {
    settings = { ...settings, ...msg.settings };
    browser.storage.local.set({ tixSettings: settings });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "OPEN_POPUP") {
    if (msg.code) {
      browser.storage.local.set({ pendingCode: msg.code });
    }
    browser.action.openPopup();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "GET_HISTORY") {
    getHistory(msg.code).then((history) => sendResponse({ history }));
    return true;
  }

  if (msg.type === "CLEAR_HISTORY") {
    clearHistory(msg.code).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ──────────────────────────────────────────────────────────────
// Periodic Background Fetch
// ──────────────────────────────────────────────────────────────

async function periodicFetch() {
  if (!settings.periodicFetch || !activeCode) return;
  try {
    const result = await queuedFetch(activeCode);
    if (result.ok) {
      updateBadge(result.data);
      checkAndNotify(result.data);
      // Notify popup if open
      try {
        browser.runtime.sendMessage({
          type: "DATA_UPDATED",
          code: activeCode,
          data: result.data,
        });
      } catch (_) {}
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────
// Storage Quota Monitoring
// ──────────────────────────────────────────────────────────────

async function monitorStorageQuota() {
  try {
    const usage = await browser.storage.local.getBytesInUse(null);
    const quota = 5 * 1024 * 1024; // 5MB typical limit
    if (usage > quota * 0.8) {
      // Cleanup old cache entries
      const all = await browser.storage.local.get(null);
      const cacheKeys = Object.keys(all).filter((k) => k.startsWith("cache_") || k === "tixCache");
      if (cacheKeys.length > 1) {
        await browser.storage.local.remove(cacheKeys.slice(0, Math.ceil(cacheKeys.length / 2)));
      }
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────
// Alarms
// ──────────────────────────────────────────────────────────────

browser.alarms.create("periodicFetch", { periodInMinutes: PERIODIC_INTERVAL_MIN });
browser.alarms.create("cacheCleanup", { periodInMinutes: 5 });
browser.alarms.create("storageMonitor", { periodInMinutes: 10 });

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "periodicFetch") {
    await periodicFetch();
  } else if (alarm.name === "cacheCleanup") {
    const now = Date.now();
    memCache.forEach((v, k) => {
      if (now - v.ts > 300_000) memCache.delete(k);
    });
  } else if (alarm.name === "storageMonitor") {
    await monitorStorageQuota();
  }
});

// ──────────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────────

(async () => {
  // Load settings from storage
  try {
    const result = await browser.storage.local.get("tixSettings");
    if (result.tixSettings) settings = { ...settings, ...result.tixSettings };
  } catch (_) {}

  // Load cache from storage
  await loadCacheFromStorage();

  console.log("[Tix48] Service worker initialized.");
})();
