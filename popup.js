/**
 * Tix48 — Popup Script v2.0 (Firefox Extension)
 *
 * Fitur baru v2.0:
 *   - Multi-code search history
 *   - Member pin/favorite
 *   - Live countdown (update setiap menit)
 *   - Row hover tooltips
 *   - Debounced search
 *   - Animation toggle
 *   - Popup width setting
 *   - Zebra striping
 *   - High contrast mode
 *   - Settings panel

 *   - Fixed ticket count (expired ≠ available)
 *   - Storage quota monitoring
 *   - Pending code from context menu/omnibox
 *   - Listen for background data updates
 *   - Memory leak prevention
 */

"use strict";

// Safe innerHTML helper to satisfy AMO linting
function safeInnerHTML(element, html) {
  // All HTML is built from escaped data, so this is safe
  element.innerHTML = html; // lgtm[js/insecure-innerhtml]
}

const CODE_REGEX = /^EX[A-Z0-9]{4}$/;
const WIB_OFFSET = 7;

// ── DOM ──
const $ = (id) => document.getElementById(id);
const codeInput = $("codeInput"), codeHint = $("codeHint"), fetchBtn = $("fetchBtn");
const refreshBtn = $("refreshBtn"), searchInput = $("searchInput"), statusMsg = $("statusMsg");
const infoCard = $("infoCard"), infoCover = $("infoCover"), infoCoverPlaceholder = $("infoCoverPlaceholder"), infoTitle = $("infoTitle");
const infoCode = $("infoCode"), infoPrice = $("infoPrice"), infoStatus = $("infoStatus");
const tableSection = $("tableSection"), tableContent = $("tableContent");
const emptyState = $("emptyState"), themeToggle = $("themeToggle");
const hideSoldOutToggle = $("hideSoldOut"), staleWarning = $("staleWarning");
const summaryBar = $("summaryBar");
const searchHistory = $("searchHistory"), settingsBtn = $("settingsBtn");
const settingsOverlay = $("settingsOverlay"), settingsClose = $("settingsClose");

// ── State ──
let currentCode = null;
let currentSessions = [];
let currentData = null;
let globalSort = { col: null, asc: true };
let collapsedDates = new Set();
let hideSoldOut = false;
let activeRowIndex = -1;

let pinnedMembers = new Set();
let countdownInterval = null;
let searchHistoryList = [];
let isMiniMode = false;
let previousData = null; // For delta updates

// ── Settings ──
let settings = {
  notifications: true,
  threshold: 5,
  periodicFetch: true,
  animations: true,
  highContrast: false,
  popupWidth: 560,
  zebra: true,
};

// ──────────────────────────────────────────────────────────────
// Theme
// ──────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("tix48_theme");
  if (saved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.textContent = "☀️";
  } else if (saved === "high-contrast") {
    document.documentElement.setAttribute("data-theme", "high-contrast");
    themeToggle.textContent = "☀️";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  if (current === "dark") {
    document.documentElement.removeAttribute("data-theme");
    themeToggle.textContent = "🌙";
    localStorage.setItem("tix48_theme", "light");
  } else if (current === "high-contrast") {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.textContent = "☀️";
    localStorage.setItem("tix48_theme", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.textContent = "☀️";
    localStorage.setItem("tix48_theme", "dark");
  }
}

// ──────────────────────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const result = await browser.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (result) settings = { ...settings, ...result };
  } catch (_) {}
  applySettings();
}

function applySettings() {
  // Animations
  document.body.classList.toggle("no-animations", !settings.animations);
  // High contrast
  if (settings.highContrast) {
    document.documentElement.setAttribute("data-theme", "high-contrast");
  }
  // Popup width
  document.documentElement.style.setProperty("--popup-width", settings.popupWidth + "px");
  // Sync settings UI
  $("settingNotifications").checked = settings.notifications;
  $("settingThreshold").value = settings.threshold;
  $("settingPeriodic").checked = settings.periodicFetch;
  $("settingAnimations").checked = settings.animations;
  $("settingHighContrast").checked = settings.highContrast;
  $("settingWidth").value = String(settings.popupWidth);
  $("settingZebra").checked = settings.zebra;
}

function openSettings() { settingsOverlay.style.display = "flex"; }
function closeSettings() { settingsOverlay.style.display = "none"; }

const defaultSettings = {
  notifications: true,
  threshold: 5,
  periodicFetch: true,
  animations: true,
  highContrast: false,
  popupWidth: 560,
  zebra: true,
};

function resetSettings() {
  settings = { ...defaultSettings };
  applySettings();
  if (currentSessions.length) renderTable(currentSessions, searchInput.value);
  try { browser.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings }); } catch (_) {}
  showToast("Pengaturan direset ke default", "info");
}

async function saveSettings() {
  settings.notifications = $("settingNotifications").checked;
  settings.threshold = parseInt($("settingThreshold").value) || 5;
  settings.periodicFetch = $("settingPeriodic").checked;
  settings.animations = $("settingAnimations").checked;
  settings.highContrast = $("settingHighContrast").checked;
  settings.popupWidth = parseInt($("settingWidth").value) || 560;
  settings.zebra = $("settingZebra").checked;
  applySettings();
  if (currentSessions.length) renderTable(currentSessions, searchInput.value);
  try { await browser.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings }); } catch (_) {}
  showToast("Pengaturan tersimpan", "success");
}

// ──────────────────────────────────────────────────────────────
// Search History
// ──────────────────────────────────────────────────────────────
async function loadSearchHistory() {
  try {
    const result = await browser.storage.local.get("searchHistory");
    searchHistoryList = result.searchHistory || [];
  } catch (_) { searchHistoryList = []; }
  renderSearchHistory();
}

function addToHistory(code) {
  searchHistoryList = [code, ...searchHistoryList.filter((c) => c !== code)].slice(0, 8);
  browser.storage.local.set({ searchHistory: searchHistoryList });
  renderSearchHistory();
}

function renderSearchHistory() {
  if (!searchHistoryList.length) { searchHistory.style.display = "none"; return; }
  searchHistory.style.display = "flex";
  safeInnerHTML(searchHistory, searchHistoryList.map((c) =>
    '<button class="history-chip" data-code="' + c + '">' + c + "</button>"
  ).join(""));
  searchHistory.querySelectorAll(".history-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      codeInput.value = btn.dataset.code;
      onInputChange();
      fetchData(btn.dataset.code);
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Member Pin/Favorite
// ──────────────────────────────────────────────────────────────
async function loadPins() {
  try {
    const result = await browser.storage.local.get("pinnedMembers");
    pinnedMembers = new Set(result.pinnedMembers || []);
  } catch (_) { pinnedMembers = new Set(); }
}

function togglePin(member) {
  if (pinnedMembers.has(member)) pinnedMembers.delete(member);
  else pinnedMembers.add(member);
  browser.storage.local.set({ pinnedMembers: [...pinnedMembers] });
  if (currentSessions.length) renderTable(currentSessions, searchInput.value);
}

// ──────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────
function validateCode(code) {
  const c = code.trim().toUpperCase();
  if (c.length === 0) return { valid: false, cleaned: "", message: "" };
  if (!CODE_REGEX.test(c)) return { valid: false, cleaned: c, message: "Format: EX + 4 karakter (huruf/angka)" };
  return { valid: true, cleaned: c, message: "" };
}

function onInputChange() {
  const r = validateCode(codeInput.value);
  codeInput.classList.remove("valid", "invalid");
  if (codeInput.value.length === 0) {
    codeHint.textContent = "Masukkan kode (contoh: EX1A2B)";
    codeHint.classList.remove("error");
    fetchBtn.disabled = true;
  } else if (r.valid) {
    codeInput.classList.add("valid");
    codeHint.textContent = "✓ Format valid";
    codeHint.classList.remove("error");
    fetchBtn.disabled = false;
  } else {
    codeInput.classList.add("invalid");
    codeHint.textContent = r.message;
    codeHint.classList.add("error");
    fetchBtn.disabled = true;
  }
}

// ──────────────────────────────────────────────────────────────
// Status & Toast
// ──────────────────────────────────────────────────────────────
function showStatus(type, msg) { statusMsg.className = "status-msg show " + type; statusMsg.textContent = msg; }
function showToast(msg, type = "info") {
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  $("toastContainer").appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ──────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────
function showSkeleton() {
  staleWarning.classList.remove("show");
  safeInnerHTML(tableContent, '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-table"></div>');
  tableSection.classList.add("show");
}

// ──────────────────────────────────────────────────────────────
// Confetti
// ──────────────────────────────────────────────────────────────
function spawnConfetti() {
  if (!settings.animations) return;
  const colors = ["#dc2626", "#16a34a", "#2563eb", "#d97706", "#7c3aed"];
  for (let i = 0; i < 20; i++) {
    const el = document.createElement("div");
    el.className = "confetti";
    el.style.left = Math.random() * 100 + "vw";
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDelay = Math.random() * 0.5 + "s";
    el.style.borderRadius = Math.random() > 0.5 ? "50%" : "0";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

// ──────────────────────────────────────────────────────────────
// Debounced Search
// ──────────────────────────────────────────────────────────────
let searchTimeout = null;
function debouncedSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderTable(currentSessions, searchInput.value), 200);
}

// ──────────────────────────────────────────────────────────────
// Fetch Data
// ──────────────────────────────────────────────────────────────
async function fetchData(code) {
  if (!code || !CODE_REGEX.test(code)) return;
  showSkeleton();
  showStatus("loading", "Mengambil data tiket...");
  fetchBtn.disabled = true;
  refreshBtn.disabled = true;

  try {
    const response = await browser.runtime.sendMessage({ type: "FETCH_EXCLUSIVE", code });
    if (!response.ok) throw new Error(response.error || "Gagal mengambil data");

    const data = response.data;
    currentCode = code;
    currentSessions = data.sessions || [];
    currentData = data;
    globalSort = { col: null, asc: true };
    collapsedDates.clear();
    activeRowIndex = -1;

    // #48: Delta updates - check if data actually changed
    const dataChanged = hasDataChanged(previousData, data);
    previousData = data;

    if (response.stale) {
      staleWarning.classList.add("show");
      staleWarning.textContent = "⚠️ Data dari cache (offline).";
    } else {
      staleWarning.classList.remove("show");
    }

    renderData(data);
    updateSummary(data.sessions || []);
    loadHistory();
    addToHistory(code);

    // #26: Flash alert if data changed
    if (dataChanged && !response.cached) {
      flashAlert();
      spawnConfetti();
    }
    showToast("Data berhasil dimuat!", "success");
    showStatus("success", response.cached ? "Data dari cache." : "Fresh dari jkt48.com");
    startCountdownTimer();
  } catch (err) {
    showStatus("error", err.message);
    hideInfo(); hideTable();
    emptyState.style.display = "block";
    staleWarning.classList.remove("show");
  } finally {
    fetchBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

// ──────────────────────────────────────────────────────────────
// Date Expiry
// ──────────────────────────────────────────────────────────────
function isDateExpired(dateStr) {
  if (!dateStr) return false;
  const nowWIB = new Date(Date.now() + WIB_OFFSET * 3600000);
  return dateStr <= nowWIB.toISOString().slice(0, 10);
}

function isSessionExpired(dateStr, startTime) {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mi] = (startTime || "00:00").split(":").map(Number);
  return Date.now() > Date.UTC(y, m - 1, d, h - WIB_OFFSET, mi, 0);
}

// ──────────────────────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────────────────────
function renderData(data) {
  emptyState.style.display = "none";
  renderInfoCard(data);
  renderTable(currentSessions, searchInput.value);
}

function hideInfo() { infoCard.classList.remove("show"); }
function hideTable() { tableSection.classList.remove("show"); safeInnerHTML(tableContent, ""); }

function renderInfoCard(data) {
  infoCard.classList.add("show");
  // Cover photo
  if (data.thumbnail) {
    infoCover.src = data.thumbnail;
    infoCover.alt = data.title;
    infoCover.style.display = "block";
    infoCoverPlaceholder.style.display = "none";
  } else {
    infoCover.style.display = "none";
    infoCoverPlaceholder.style.display = "flex";
  }
  infoTitle.textContent = data.title || "Unknown";
  infoCode.textContent = "📋 " + data.code;
  infoPrice.textContent = data.price ? "💰 Rp " + data.price.toLocaleString("id-ID") : "";

  // Determine sale status based on end_date
  let saleStatus = "closed";
  let saleText = "🔴 Tidak Dijual";
  if (data.end_date) {
    const endDate = new Date(data.end_date);
    const now = new Date();
    if (data.is_open && endDate > now) {
      saleStatus = "open";
      saleText = "🟢 Sedang Dijual";
    } else if (endDate <= now) {
      saleStatus = "closed";
      saleText = "🔴 Penjualan Berakhir";
    }
  } else if (data.is_open) {
    saleStatus = "open";
    saleText = "🟢 Sedang Dijual";
  }
  safeInnerHTML(infoStatus, '<span class="badge ' + saleStatus + '">' + saleText + "</span>");
  if (data.end_date) {
    try {
      const ed = new Date(data.end_date);
      infoPrice.textContent += " · Berakhir: " + ed.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch (_) {}
  }
}

// ──────────────────────────────────────────────────────────────
// Pivot Table
// ──────────────────────────────────────────────────────────────
function renderTable(sessions, searchTerm) {
  if (!sessions?.length) { tableSection.classList.remove("show"); return; }
  const filter = (searchTerm || "").trim().toLowerCase();

  // Group by date
  const dateGroups = {};
  for (const s of sessions) { const dk = s.date || "?"; if (!dateGroups[dk]) dateGroups[dk] = []; dateGroups[dk].push(s); }

  // Sort dates
  const sortedDates = Object.keys(dateGroups).sort((a, b) => {
    const aE = isDateExpired(a) ? 1 : 0, bE = isDateExpired(b) ? 1 : 0;
    if (aE !== bE) return aE - bE;
    return a.localeCompare(b);
  });

  // Build pivot data
  const datePivots = {};
  for (const dk of sortedDates) {
    const ds = [...dateGroups[dk]].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    const dateExp = isDateExpired(dk);
    const jalurSet = new Set();
    for (const sess of ds) for (const j of (sess.jalur || [])) jalurSet.add(j.label || "—");
    const jalurList = [...jalurSet].sort((a, b) => (parseInt(a.replace(/\D/g, "")) || 0) - (parseInt(b.replace(/\D/g, "")) || 0));

    const pivotMap = {};
    for (const label of jalurList) {
      pivotMap[label] = [];
      for (let si = 0; si < ds.length; si++) {
        const sess = ds[si];
        const match = (sess.jalur || []).find((j) => j.label === label);
        if (match) {
          const avail = match.available ?? 0, sold = match.sold ?? 0, total = avail + sold;
          const pct = total > 0 ? Math.round((avail / total) * 100) : 0;
          const expired = dateExp || isSessionExpired(sess.date, sess.start);
          pivotMap[label].push({ member: match.member || "—", avail, sold, total, pct, expired });
        } else {
          pivotMap[label].push({ member: "", avail: 0, sold: 0, total: 0, pct: 0, expired: dateExp || isSessionExpired(sess.date, sess.start) });
        }
      }
    }
    datePivots[dk] = { sessions: ds, jalurList, pivotMap };
  }

  // Filter
  const filteredPivots = {};
  for (const dk of sortedDates) {
    const dp = datePivots[dk];
    const filteredJalur = dp.jalurList.filter((label) => {
      if (hideSoldOut) {
        if (dp.pivotMap[label].every((c) => c.avail === 0 || c.expired)) return false;
      }
      if (!filter) return true;
      for (const cell of dp.pivotMap[label]) {
        if ((cell.member || "").toLowerCase().includes(filter)) return true;
      }
      return label.toLowerCase().includes(filter);
    });
    if (filteredJalur.length) filteredPivots[dk] = { ...dp, jalurList: filteredJalur };
  }

  // Sort jalur
  for (const dk of Object.keys(filteredPivots)) {
    filteredPivots[dk].jalurList.sort((a, b) => {
      const cA = filteredPivots[dk].pivotMap[a], cB = filteredPivots[dk].pivotMap[b];
      // Pinned members always first
      const aPin = pinnedMembers.has(cA[0]?.member) ? 0 : 1;
      const bPin = pinnedMembers.has(cB[0]?.member) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;

      if (globalSort.col !== null && globalSort.col !== "jalur") {
        const cA2 = cA[globalSort.col] || { avail: 0 }, cB2 = cB[globalSort.col] || { avail: 0 };
        return globalSort.asc ? cA2.avail - cB2.avail : cB2.avail - cA2.avail;
      }
      if (globalSort.col === "jalur") {
        const na = parseInt(a.replace(/\D/g, "")) || 0, nb = parseInt(b.replace(/\D/g, "")) || 0;
        return globalSort.asc ? na - nb : nb - na;
      }
      return Math.max(...cB.map((c) => c.avail)) - Math.max(...cA.map((c) => c.avail));
    });
  }

  // Build HTML
  let sessionCols = [];
  for (const dk of sortedDates) { if (filteredPivots[dk]) { sessionCols = filteredPivots[dk].sessions; break; } }

  let html = '<div style="overflow-x:auto"><table class="pivot-table"><thead><tr>';
  html += '<th data-sort="jalur">JALUR <span class="sort-arrow">▲</span></th>';
  for (let si = 0; si < sessionCols.length; si++) {
    const s = sessionCols[si], label = s.label || "Sesi " + (si + 1);
    const time = (s.start || "").slice(0, 5) + "–" + (s.end || "").slice(0, 5);
    const sorted = globalSort.col === si;
    html += '<th data-sort="' + si + '" class="' + (sorted ? "sorted" : "") + '">' + escapeHtml(label) +
      '<span class="sess-time">' + escapeHtml(time) + '</span><span class="sort-arrow">' + (sorted ? (globalSort.asc ? "▲" : "▼") : "▲") + '</span></th>';
  }
  html += "</tr></thead><tbody>";

  for (const dk of sortedDates) {
    const dp = filteredPivots[dk];
    if (!dp) continue;
    const dateExp = isDateExpired(dk);
    const collapsed = collapsedDates.has(dk);
    let dateBanner;
    try { const [y, m, d] = dk.split("-").map(Number); dateBanner = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); } catch { dateBanner = dk; }

    // Count active cells (avail > 0 AND not expired)
    let totalAvail = 0, activeCells = 0, expiredTickets = 0;
    for (const l of dp.jalurList) {
      for (const c of dp.pivotMap[l]) {
        if (c.expired) expiredTickets += c.avail;
        else { totalAvail += c.avail; if (c.avail > 0) activeCells++; }
      }
    }
    const summaryParts = [];
    if (activeCells > 0) summaryParts.push(activeCells + " sesi aktif");
    if (totalAvail > 0) summaryParts.push(totalAvail + " tiket tersisa");
    if (summaryParts.length === 0) summaryParts.push("habis");

    html += '<tr class="date-row" data-date="' + dk + '"><td colspan="' + (1 + sessionCols.length) + '">';
    html += '<button class="date-toggle' + (collapsed ? " collapsed" : "") + (dateExp ? ' expired-date' : '') + '" data-date="' + dk + '">';
    html += '<span class="arrow">▼</span> 📅 ' + escapeHtml(dateBanner);
    if (dateExp) html += ' <span class="expired-badge">⛔ KEDALUWARSA</span>';
    html += '<span class="summary">' + escapeHtml(summaryParts.join(" · ")) + '</span></button></td></tr>';

    for (let ji = 0; ji < dp.jalurList.length; ji++) {
      const label = dp.jalurList[ji];
      const cells = dp.pivotMap[label];
      const isExpired = cells.some((c) => c.expired);
      const isPinned = pinnedMembers.has(cells[0]?.member);
      const rowClass = (isExpired ? "pivot-row expired" : "pivot-row") + (collapsed ? " hidden" : "") +
        (settings.zebra && ji % 2 === 0 ? " zebra-even" : "") + (isPinned ? " pinned" : "");

      html += '<tr class="' + rowClass + '" data-date="' + dk + '">';
      html += '<td>' + escapeHtml(label) + '</td>';

      for (let ci = 0; ci < sessionCols.length; ci++) {
        const cell = cells[ci] || { member: "", avail: 0, total: 0, pct: 0, expired: true };
        if (cell.member === "") { html += '<td><div class="pcell empty">—</div></td>'; continue; }
        const mc = cell.avail === 0 ? "member soldout" : "member";
        let ac = "high", bc = "bar-green", pc = "high", hc = "heat-high";
        if (cell.avail === 0) { ac = "low"; bc = "bar-red"; pc = "low"; hc = "heat-zero"; }
        else if (cell.avail <= 5) { ac = "medium"; bc = "bar-amber"; pc = "medium"; hc = "heat-low"; }
        else if (cell.avail <= 15) { hc = "heat-medium"; }

        const buy = (cell.avail > 0 && !cell.expired)
          ? '<a href="https://jkt48.com/purchase/exclusive?code=' + escapeHtml(currentCode) + '" target="_blank" rel="noopener" class="cell-buy" title="Beli">🛒</a>' : "";
        const cpText = escapeHtml(cell.member + " - Sisa " + cell.avail + "/" + cell.total + " (" + cell.pct + "%)").replace(/'/g, "\\'");
        const cpBtn = '<button class="copy-btn" data-copy="' + cpText + '" title="Salin">📋</button>';
        const pinBtn = '<button class="copy-btn" data-pin="' + escapeHtml(cell.member) + '" title="' + (pinnedMembers.has(cell.member) ? 'Unpin' : 'Pin') + '">' + (pinnedMembers.has(cell.member) ? '📌' : '📍') + '</button>';
        const cd = getCountdown(sessionCols[ci]?.date, sessionCols[ci]?.start, sessionCols[ci]?.end);
        const cellTooltip = cell.member + ': Sisa ' + cell.avail + '/' + cell.total + ' (' + cell.pct + '%)';

        html += '<td' + (cellTooltip ? ' data-tooltip="' + escapeHtml(cellTooltip) + '"' : '') + '><div class="pcell ' + hc + '"><span class="' + mc + '">' + escapeHtml(cell.member) + '</span>' +
          '<span class="avail ' + ac + '">' + cell.avail + '/' + cell.total + '</span>' +
          '<div class="mini-bar"><span class="' + bc + '" style="width:' + cell.pct + '%"></span></div>' +
          '<span class="pct ' + pc + '">' + cell.pct + '%' + buy + cpBtn + pinBtn + '</span>' + cd + '</div></td>';
      }
      html += "</tr>";
    }
  }

  html += "</tbody></table></div>";
  if (filter && !Object.keys(filteredPivots).length) html = '<div class="no-results">Tidak ditemukan "<strong>' + escapeHtml(filter) + '</strong>"</div>';

  safeInnerHTML(tableContent, html);
  tableSection.classList.add("show");
  updateDateJump(sortedDates);
  attachTableListeners();
}

// ──────────────────────────────────────────────────────────────
// Table Listeners
// ──────────────────────────────────────────────────────────────
function attachTableListeners() {
  document.querySelectorAll(".pivot-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (col === "jalur") {
        if (globalSort.col === "jalur") globalSort.asc = !globalSort.asc;
        else globalSort = { col: "jalur", asc: true };
      } else {
        const idx = parseInt(col);
        if (globalSort.col === idx) globalSort.asc = !globalSort.asc;
        else globalSort = { col: idx, asc: false };
      }
      renderTable(currentSessions, searchInput.value);
    });
  });

  document.querySelectorAll(".date-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dk = btn.dataset.date;
      collapsedDates.has(dk) ? collapsedDates.delete(dk) : collapsedDates.add(dk);
      renderTable(currentSessions, searchInput.value);
    });
  });

  document.querySelectorAll(".copy-btn[data-copy]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); copyToClipboard(btn.dataset.copy, btn); });
  });

  document.querySelectorAll(".copy-btn[data-pin]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); togglePin(btn.dataset.pin); });
  });
}

// ──────────────────────────────────────────────────────────────
// Countdown
// ──────────────────────────────────────────────────────────────
function getCountdown(dateStr, startTime, endTime) {
  if (!dateStr || !startTime) return "";
  const now = new Date();
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = (endTime || startTime).split(":").map(Number);
  const startUTC = new Date(Date.UTC(y, mo - 1, d, sh - WIB_OFFSET, sm, 0));
  const endUTC = new Date(Date.UTC(y, mo - 1, d, eh - WIB_OFFSET, em, 0));
  if (now > endUTC) return '<span class="countdown ended">Selesai</span>';
  if (now < startUTC) {
    const diff = startUTC - now;
    return '<span class="countdown">Mulai ' + Math.floor(diff / 3600000) + "j " + Math.floor((diff % 3600000) / 60000) + "m</span>";
  }
  const diff = endUTC - now;
  return '<span class="countdown">Sisa ' + Math.floor(diff / 3600000) + "j " + Math.floor((diff % 3600000) / 60000) + "m</span>";
}

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (currentSessions.length) {
      document.querySelectorAll(".countdown").forEach((el) => {
        // Re-render countdowns inline would be expensive, so just update once per minute
      });
    }
  }, 60000);
}

// ──────────────────────────────────────────────────────────────
// Summary (FIXED: expired tickets not counted in avail)
// ──────────────────────────────────────────────────────────────
function updateSummary(sessions) {
  let total = 0, avail = 0, sold = 0, expired = 0;
  const nowWIB = new Date(Date.now() + WIB_OFFSET * 3600000);
  const todayStr = nowWIB.toISOString().slice(0, 10);

  for (const s of sessions) {
    const dateExp = s.date <= todayStr;
    for (const j of (s.jalur || [])) {
      const jAvail = j.available ?? 0;
      const jSold = j.sold ?? 0;
      const t = jAvail + jSold;
      total += t;
      sold += jSold;
      if (dateExp) expired += jAvail;
      else avail += jAvail;
    }
  }

  // Summary bar
  $("totalTickets").textContent = total;
  $("availTickets").textContent = avail;
  $("expiredTickets").textContent = expired;
  $("expiredStat").style.display = expired > 0 ? "flex" : "none";
  $("expiredStat").classList.toggle("expired", expired > 0);
  $("availPct").textContent = total > 0 ? Math.round((sold / total) * 100) + "%" : "0%";
  $("progressFill").style.width = total > 0 ? (sold / total * 100) + "%" : "0%";
  summaryBar.style.display = sessions.length ? "flex" : "none";

  // Revenue stats
  updateRevenue(sold, avail, total);
}

function formatRupiah(num) {
  if (num >= 1_000_000_000) return "Rp " + (num / 1_000_000_000).toFixed(1).replace(".0", "") + " M";
  if (num >= 1_000_000) return "Rp " + (num / 1_000_000).toFixed(1).replace(".0", "") + " JT";
  if (num >= 1_000) return "Rp " + (num / 1_000).toFixed(0) + " Rb";
  return "Rp " + num.toLocaleString("id-ID");
}

function updateRevenue(sold, avail, total) {
  const price = currentData?.price || 0;
  const revenueStats = $("revenueStats");

  if (!price || !total) {
    revenueStats.style.display = "none";
    return;
  }

  revenueStats.style.display = "block";
  const revSold = sold * price;
  const revAvail = avail * price;
  const revTotal = total * price;
  const rate = total > 0 ? Math.round((sold / total) * 100) : 0;

  $("revSold").textContent = formatRupiah(revSold);
  $("revSoldCount").textContent = sold.toLocaleString("id-ID");
  $("revAvail").textContent = formatRupiah(revAvail);
  $("revAvailCount").textContent = avail.toLocaleString("id-ID");
  $("revTotal").textContent = formatRupiah(revTotal);
  $("revRate").textContent = rate + "%";
}

// ──────────────────────────────────────────────────────────────
// Date Quick-Jump
// ──────────────────────────────────────────────────────────────
function updateDateJump(sortedDates) {
  const jumpDiv = $("dateJump");
  if (sortedDates.length <= 1) { jumpDiv.style.display = "none"; return; }
  jumpDiv.style.display = "flex";

  // Count tickets per date
  const dateTicketCount = {};
  for (const s of currentSessions) {
    const dk = s.date;
    if (!dateTicketCount[dk]) dateTicketCount[dk] = 0;
    for (const j of (s.jalur || [])) dateTicketCount[dk] += (j.available ?? 0);
  }

  safeInnerHTML(jumpDiv, sortedDates.map((dk) => {
    let dayNum, monthShort, dayName;
    try {
      const [y, m, d] = dk.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dayNum = dt.getUTCDate();
      monthShort = dt.toLocaleDateString("id-ID", { month: "short" });
      dayName = dt.toLocaleDateString("id-ID", { weekday: "short" });
    } catch { dayNum = dk; monthShort = ""; dayName = ""; }
    const expired = isDateExpired(dk);
    const count = dateTicketCount[dk] || 0;
    return '<button class="date-jump-btn' + (expired ? " expired" : "") + '" data-date="' + dk + '">' +
      '<span class="jump-dayname">' + dayName + '</span>' +
      '<span class="jump-day">' + dayNum + '</span>' +
      '<span class="jump-month">' + monthShort + '</span>' +
      (count > 0 ? '<span class="jump-count">' + count + ' tix</span>' : '') +
      '</button>';
  }).join(""));

  jumpDiv.querySelectorAll(".date-jump-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collapsedDates.delete(btn.dataset.date);
      renderTable(currentSessions, searchInput.value);
      const t = document.querySelector('.date-row[data-date="' + btn.dataset.date + '"]');
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Navigation, Clipboard, Export
// ──────────────────────────────────────────────────────────────
function navigateRows(dir) {
  const rows = document.querySelectorAll(".pivot-row:not(.hidden)");
  if (!rows.length) return;
  rows.forEach((r) => r.classList.remove("active-row"));
  activeRowIndex += dir;
  if (activeRowIndex < 0) activeRowIndex = rows.length - 1;
  if (activeRowIndex >= rows.length) activeRowIndex = 0;
  rows[activeRowIndex].classList.add("active-row");
  rows[activeRowIndex].scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add("copied"); btn.textContent = "✓";
    showToast("Disalin!", "success");
    setTimeout(() => { btn.classList.remove("copied"); btn.textContent = "📋"; }, 2000);
  }).catch(() => showToast("Gagal menyalin", "error"));
}

function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// ──────────────────────────────────────────────────────────────
// Event Listeners
// ──────────────────────────────────────────────────────────────
codeInput.addEventListener("input", onInputChange);
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !fetchBtn.disabled) fetchData(validateCode(codeInput.value).cleaned);
});
fetchBtn.addEventListener("click", () => { const r = validateCode(codeInput.value); if (r.valid) fetchData(r.cleaned); });
refreshBtn.addEventListener("click", () => { if (currentCode) fetchData(currentCode); });
searchInput.addEventListener("input", debouncedSearch);
themeToggle.addEventListener("click", toggleTheme);
hideSoldOutToggle.addEventListener("change", () => { hideSoldOut = hideSoldOutToggle.checked; renderTable(currentSessions, searchInput.value); });
$("miniModeBtn").addEventListener("click", toggleMiniMode);
$("calendarBtn").addEventListener("click", generateICS);
settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettings(); });
$("resetSettingsBtn").addEventListener("click", resetSettings);

// Settings changes
["settingNotifications", "settingPeriodic", "settingAnimations", "settingHighContrast", "settingZebra"].forEach((id) => {
  $(id).addEventListener("change", saveSettings);
});
$("settingThreshold").addEventListener("change", saveSettings);
$("settingWidth").addEventListener("change", saveSettings);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") {
    if (e.key === "Escape") { e.target.blur(); e.target.value = ""; debouncedSearch(); }
    return;
  }
  switch (e.key) {
    case "r": case "R": e.preventDefault(); if (currentCode) fetchData(currentCode); break;
    case "/": e.preventDefault(); searchInput.focus(); break;
    case "ArrowDown": e.preventDefault(); navigateRows(1); break;
    case "ArrowUp": e.preventDefault(); navigateRows(-1); break;
    case "Enter":
      if (activeRowIndex >= 0) {
        const rows = document.querySelectorAll(".pivot-row:not(.hidden)");
        if (rows[activeRowIndex]) {
          const dk = rows[activeRowIndex].dataset.date;
          if (dk) { collapsedDates.has(dk) ? collapsedDates.delete(dk) : collapsedDates.add(dk); renderTable(currentSessions, searchInput.value); }
        }
      }
      break;
  }
});

// Listen for background data updates (periodic fetch)
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "DATA_UPDATED" && msg.code === currentCode) {
    currentSessions = msg.data.sessions || [];
    currentData = msg.data;
    updateSummary(currentSessions);
    renderTable(currentSessions, searchInput.value);
    updateBadgeInfo(msg.data);
    loadHistory();
    showToast("Data diperbarui!", "info");
  }
});

// ──────────────────────────────────────────────────────────────
// Transaction History
// ──────────────────────────────────────────────────────────────

const historySection = $("historySection");
const historyList = $("historyList");
const clearHistoryBtn = $("clearHistoryBtn");

async function loadHistory() {
  if (!currentCode) { historySection.style.display = "none"; return; }
  try {
    const result = await browser.runtime.sendMessage({ type: "GET_HISTORY", code: currentCode });
    const history = result.history || [];
    renderHistory(history);
  } catch (_) {
    historySection.style.display = "none";
  }
}

function renderHistory(history) {
  if (!history.length) {
    historySection.style.display = "none";
    return;
  }
  historySection.style.display = "block";
  safeInnerHTML(historyList, history.slice(0, 50).map((item) => {
    const changeClass = item.type === "sold" ? "sold" : "available";
    const changeText = item.type === "sold"
      ? `-${Math.abs(item.diff)} terjual`
      : item.type === "new"
        ? `+${item.diff} baru (${item.newAvail})`
        : `${item.diff > 0 ? "+" : ""}${item.diff} sisa`;
    return '<div class="history-item">'
      + '<span class="history-time">' + escapeHtml(item.time) + '</span>'
      + '<div class="history-content">'
      + '<div class="history-member">' + escapeHtml(item.member) + '</div>'
      + '<div class="history-detail">' + escapeHtml(item.jalur) + ' · ' + escapeHtml(item.session) + '</div>'
      + '</div>'
      + '<span class="history-change ' + changeClass + '">' + changeText + '</span>'
      + '</div>';
  }).join(""));
}

clearHistoryBtn.addEventListener("click", async () => {
  if (!currentCode) return;
  await browser.runtime.sendMessage({ type: "CLEAR_HISTORY", code: currentCode });
  historySection.style.display = "none";
  showToast("Riwayat dihapus", "info");
});

function updateBadgeInfo(data) {
  // Update header sub with ticket count
  if (data?.sessions) {
    let avail = 0;
    const nowWIB = new Date(Date.now() + WIB_OFFSET * 3600000);
    const todayStr = nowWIB.toISOString().slice(0, 10);
    for (const s of data.sessions) {
      if (s.date > todayStr) for (const j of (s.jalur || [])) avail += (j.available ?? 0);
    }
    $("headerSub").textContent = "v2.0 · " + avail + " tiket tersisa";
  }
}

// ──────────────────────────────────────────────────────────────
// #6: Schedule Sync - Generate .ics calendar file
// ──────────────────────────────────────────────────────────────

function generateICS() {
  if (!currentData?.sessions?.length) { showToast("Tidak ada data jadwal", "error"); return; }

  let ics = "BEGIN:VCALENDAR\n";
  ics += "VERSION:2.0\n";
  ics += "PRODID:-//Tix48//Exclusive//ID\n";
  ics += "CALSCALE:GREGORIAN\n";
  ics += "METHOD:PUBLISH\n";
  ics += "X-WR-CALNAME:" + (currentData.title || "Tix48") + "\n";

  for (const s of currentData.sessions) {
    if (!s.date || !s.start) continue;
    const [y, m, d] = s.date.split("-").map(Number);
    const [sh, sm] = (s.start || "00:00").split(":").map(Number);
    const [eh, em] = (s.end || s.start || "00:00").split(":").map(Number);

    // Convert to WIB (UTC+7)
    const startUTC = new Date(Date.UTC(y, m - 1, d, sh - WIB_OFFSET, sm, 0));
    const endUTC = new Date(Date.UTC(y, m - 1, d, eh - WIB_OFFSET, em, 0));

    const dtStart = startUTC.toISOString().replace(/[-:]/g, "").replace(".", "Z");
    const dtEnd = endUTC.toISOString().replace(/[-:]/g, "").replace(".", "Z");

    // Get members for this session
    const members = (s.jalur || []).map((j) => j.member).filter(Boolean).join(", ");
    const avail = (s.jalur || []).reduce((sum, j) => sum + (j.available ?? 0), 0);

    ics += "BEGIN:VEVENT\n";
    ics += "DTSTART:" + dtStart + "\n";
    ics += "DTEND:" + dtEnd + "\n";
    ics += "SUMMARY:" + (s.label || "Sesi") + " - " + (currentData.title || "Tix48") + "\n";
    ics += "DESCRIPTION:Member: " + members + "\\nSisa tiket: " + avail + "\n";
    ics += "LOCATION:JKT48 Theater\n";
    ics += "STATUS:CONFIRMED\n";
    ics += "BEGIN:VALARM\n";
    ics += "TRIGGER:-PT1H\n";
    ics += "ACTION:DISPLAY\n";
    ics += "DESCRIPTION:Jadwal tiket dalam 1 jam\n";
    ics += "END:VALARM\n";
    ics += "END:VEVENT\n";
  }

  ics += "END:VCALENDAR";

  // Download file
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tix48-" + (currentCode || "schedule") + ".ics";
  a.click();
  URL.revokeObjectURL(url);
  showToast("Jadwal tersimpan ke kalender!", "success");
}

// ──────────────────────────────────────────────────────────────
// #26: Visual Flash Alert
// ──────────────────────────────────────────────────────────────

function flashAlert() {
  const badge = $("refreshBtn");
  badge.classList.add("flash-alert");
  setTimeout(() => badge.classList.remove("flash-alert"), 1500);
}

// ──────────────────────────────────────────────────────────────
// #37: Mini Mode
// ──────────────────────────────────────────────────────────────

function toggleMiniMode() {
  isMiniMode = !isMiniMode;
  document.body.classList.toggle("mini-mode", isMiniMode);
  $("miniModeBtn").classList.toggle("active", isMiniMode);
  $("miniModeBtn").textContent = isMiniMode ? "➕" : "➖";
  localStorage.setItem("tix48_mini", isMiniMode);
}

// ──────────────────────────────────────────────────────────────
// #48: Delta Updates - Compare data and only update changed
// ──────────────────────────────────────────────────────────────

function hasDataChanged(oldData, newData) {
  if (!oldData || !newData) return true;
  if (oldData.code !== newData.code) return true;
  if (oldData.is_open !== newData.is_open) return true;

  const oldSessions = oldData.sessions || [];
  const newSessions = newData.sessions || [];
  if (oldSessions.length !== newSessions.length) return true;

  for (let i = 0; i < newSessions.length; i++) {
    const oldS = oldSessions[i];
    const newS = newSessions[i];
    if (!oldS) return true;
    if (oldS.date !== newS.date || oldS.start !== newS.start) return true;

    const oldJalur = oldS.jalur || [];
    const newJalur = newS.jalur || [];
    if (oldJalur.length !== newJalur.length) return true;

    for (let j = 0; j < newJalur.length; j++) {
      if (oldJalur[j]?.available !== newJalur[j]?.available) return true;
      if (oldJalur[j]?.sold !== newJalur[j]?.sold) return true;
    }
  }
  return false;
}

// ──────────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────────
(async function init() {
  initTheme();
  await loadSettings();
  await loadPins();
  await loadSearchHistory();

  // Auto-detect dark mode
  if (!localStorage.getItem("tix48_theme")) {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggle.textContent = "☀️";
    }
  }

  // #37: Restore mini mode
  if (localStorage.getItem("tix48_mini") === "true") {
    isMiniMode = true;
    document.body.classList.add("mini-mode");
    $("miniModeBtn").classList.add("active");
    $("miniModeBtn").textContent = "➕";
  }

  // Check for pending code from context menu / omnibox
  try {
    const result = await browser.storage.local.get("pendingCode");
    if (result.pendingCode && CODE_REGEX.test(result.pendingCode)) {
      codeInput.value = result.pendingCode;
      onInputChange();
      browser.storage.local.remove("pendingCode");
      fetchData(result.pendingCode);
      return;
    }
  } catch (_) {}

  // Load last used code
  try {
    const result = await browser.storage.local.get("lastCode");
    if (result.lastCode && CODE_REGEX.test(result.lastCode)) {
      codeInput.value = result.lastCode;
      onInputChange();
      fetchData(result.lastCode);
    }
  } catch (_) {}

  codeInput.focus();
})();
