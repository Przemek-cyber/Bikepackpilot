(() => {
  "use strict";

  const STORAGE_KEY = "bikepacking-planner-v2";
  const SEGMENT_LENGTH = 50;

  const SURFACE_MOD = { "Asfalt": 0, "Gravel": -0.175, "Szuter techniczny": -0.3 };
  const WIND_MOD = { "brak": 0, "umiarkowany": -0.2, "silny": -0.3 };
  const PRECIP_MOD = { "brak": 0, "lekkie": -0.1, "intensywne": -0.25 };

  const state = load() || {
    lang: "pl",
    basePace: 110,
    stages: [],
    checklist: {},
    gearOpen: {},
    safety: { frequency: "none", remindersEnabled: false, contacts: [] },
  };
  if (!state.safety) state.safety = { frequency: "none", remindersEnabled: false, contacts: [] };
  if (!Array.isArray(state.safety.contacts)) state.safety.contacts = [];
  if (!state.gearOpen) state.gearOpen = {};
  if (state.basePace == null) state.basePace = 110;
  if (!SUPPORTED_LANGS.includes(state.lang)) state.lang = "pl";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* storage unavailable — continue without persistence */ }
  }

  function t(key) {
    const dict = I18N[state.lang] || I18N.pl;
    return dict[key] != null ? dict[key] : (I18N.pl[key] || key);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ---------------- License gate (Lemon Squeezy) ----------------
  const LEMONSQUEEZY_PRODUCT_ID = "1371962";
  const LICENSE_STORAGE_KEY = "bikepacking-planner-license";
  const BUY_URL = "https://przemek.lemonsqueezy.com/checkout/buy/a4a0fd2b-fd57-418e-b529-ee37dccca662";

  const gateEl = document.getElementById("license-gate");
  const shellEl = document.getElementById("app-shell");
  const licenseInput = document.getElementById("license-input");
  const licenseFeedback = document.getElementById("license-feedback");
  const btnActivateLicense = document.getElementById("btn-activate-license");
  const licenseBuyLink = document.getElementById("license-buy-link");
  if (licenseBuyLink) licenseBuyLink.href = BUY_URL;

  function loadLicense() {
    try {
      const raw = localStorage.getItem(LICENSE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveLicense(data) {
    try { localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { /* storage unavailable */ }
  }
  function unlockApp() {
    gateEl.style.display = "none";
    shellEl.style.display = "";
  }
  function getDeviceInstanceName() {
    let name = null;
    try { name = localStorage.getItem("bikepacking-planner-device-id"); } catch (e) {}
    if (!name) {
      name = "device-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem("bikepacking-planner-device-id", name); } catch (e) {}
    }
    return name;
  }
  function showLicenseFeedback(msg) {
    licenseFeedback.textContent = msg;
    licenseFeedback.style.display = msg ? "block" : "none";
  }

  async function activateLicenseKey(key) {
    const instanceName = getDeviceInstanceName();
    const res = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: `license_key=${encodeURIComponent(key)}&instance_name=${encodeURIComponent(instanceName)}`,
    });
    const data = await res.json();
    return data;
  }

  async function attemptActivation(key) {
    if (!key) { showLicenseFeedback(t("license.noKey")); licenseInput.focus(); return; }
    showLicenseFeedback(t("license.verifying"));
    btnActivateLicense.disabled = true;
    try {
      const data = await activateLicenseKey(key);
      if (!data.activated) {
        showLicenseFeedback(data.error || t("license.invalid"));
        btnActivateLicense.disabled = false;
        return;
      }
      const productId = data.meta && String(data.meta.product_id);
      if (productId !== LEMONSQUEEZY_PRODUCT_ID) {
        showLicenseFeedback(t("license.wrongProduct"));
        btnActivateLicense.disabled = false;
        return;
      }
      saveLicense({ key, instanceId: data.instance && data.instance.id, activatedAt: Date.now() });
      // Strip ?license=... from the address bar so the key isn't left visible/bookmarked
      if (window.history && window.history.replaceState) {
        const clean = window.location.origin + window.location.pathname;
        window.history.replaceState({}, "", clean);
      }
      unlockApp();
    } catch (e) {
      showLicenseFeedback(t("license.networkError"));
      btnActivateLicense.disabled = false;
    }
  }

  btnActivateLicense.addEventListener("click", () => attemptActivation(licenseInput.value.trim()));

  // Skip the gate if already activated on this device
  const existingLicense = loadLicense();
  if (existingLicense && existingLicense.key) {
    unlockApp();
  } else {
    // Auto-activate if a license key arrived via URL (?license=[license_key] from
    // Lemon Squeezy's post-purchase redirect) — skips manual copy/paste entirely.
    const urlParams = new URLSearchParams(window.location.search);
    const urlKey = urlParams.get("license");
    if (urlKey) {
      licenseInput.value = urlKey;
      attemptActivation(urlKey);
    }
  }

  // ---------------- i18n ----------------
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.dataset.i18nPh)); });
    document.getElementById("lang-current").textContent = state.lang.toUpperCase();
    document.querySelectorAll(".lang-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === state.lang);
    });
  }

  // ---------------- Bottom nav / screens ----------------
  const navItems = document.querySelectorAll(".nav-item");
  const screens = document.querySelectorAll(".screen");
  const fab = document.getElementById("fab-add");

  function setActiveTab(tabId) {
    navItems.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    screens.forEach((s) => s.classList.toggle("active", s.id === `panel-${tabId}`));
    fab.classList.toggle("hidden", tabId === "sprzet" || tabId === "nearby");
    fab.dataset.forTab = tabId;
    if (tabId === "sprzet") renderGear();
  }
  navItems.forEach((btn) => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

  // ---------------- Sheets ----------------
  const overlay = document.getElementById("sheet-overlay");
  function openSheet(id) {
    document.getElementById(id).classList.add("show");
    overlay.classList.add("show");
  }
  function closeSheet(id) {
    document.getElementById(id).classList.remove("show");
    if (!document.querySelector(".sheet.show")) overlay.classList.remove("show");
  }
  function closeAllSheets() {
    document.querySelectorAll(".sheet.show").forEach((s) => s.classList.remove("show"));
    overlay.classList.remove("show");
  }
  document.querySelectorAll("[data-close-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => closeSheet(btn.dataset.closeSheet));
  });
  overlay.addEventListener("click", closeAllSheets);

  fab.addEventListener("click", () => {
    const tab = fab.dataset.forTab || "geo";
    if (tab === "bezpieczenstwo") openContactSheet(null);
    else openStageSheet(null);
  });

  // ---------------- Language sheet ----------------
  document.getElementById("btn-lang-open").addEventListener("click", () => openSheet("sheet-lang"));
  document.querySelectorAll(".lang-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.lang = btn.dataset.lang;
      save();
      applyI18n();
      renderSegmentInputs();
      renderStages();
      renderGear();
      renderContacts();
      updateReminderUI();
      closeSheet("sheet-lang");
    });
  });

  // ---------------- Geografia: tempo ----------------
  const stageList = document.getElementById("stage-list");
  const emptyStages = document.getElementById("empty-stages");
  const segmentsContainer = document.getElementById("segments-container");
  const segmentsHint = document.getElementById("segments-hint");

  const tempoInput = document.getElementById("f-tempo");
  tempoInput.value = state.basePace;
  tempoInput.addEventListener("input", () => {
    const v = parseFloat(tempoInput.value);
    state.basePace = v > 0 ? v : state.basePace;
    save(); renderStages();
  });

  let draftSegments = [];
  let editingStageIndex = null;

  function segmentRanges(dystans) {
    const count = Math.max(1, Math.ceil(dystans / SEGMENT_LENGTH));
    const ranges = [];
    for (let i = 0; i < count; i++) {
      const from = i * SEGMENT_LENGTH;
      const to = Math.min(dystans, (i + 1) * SEGMENT_LENGTH);
      ranges.push({ from, to });
    }
    return ranges;
  }
  function defaultSegment() { return { nawierzchnia: "Asfalt", temp: 20, wiatr: "brak", opady: "brak" }; }

  function renderSegmentInputs() {
    const dystans = parseFloat(document.getElementById("f-dystans").value);
    segmentsContainer.innerHTML = "";
    if (!dystans || dystans <= 0) {
      segmentsHint.style.display = "block";
      draftSegments = [];
      return;
    }
    segmentsHint.style.display = "none";
    const ranges = segmentRanges(dystans);
    draftSegments = ranges.map((r, i) => draftSegments[i] || defaultSegment());
    draftSegments.length = ranges.length;

    ranges.forEach((r, i) => {
      const seg = draftSegments[i] || defaultSegment();
      draftSegments[i] = seg;
      const row = document.createElement("div");
      row.className = "segment-row";
      row.innerHTML = `
        <div class="seg-range">${r.from}–${r.to.toFixed(0)} km</div>
        <div>
          <label>${t("geo.surface")}</label>
          <select data-seg="${i}" data-field="nawierzchnia">
            <option value="Asfalt" ${seg.nawierzchnia === "Asfalt" ? "selected" : ""}>${t("geo.surfaceAsphalt")}</option>
            <option value="Gravel" ${seg.nawierzchnia === "Gravel" ? "selected" : ""}>${t("geo.surfaceGravel")}</option>
            <option value="Szuter techniczny" ${seg.nawierzchnia === "Szuter techniczny" ? "selected" : ""}>${t("geo.surfaceTechnical")}</option>
          </select>
        </div>
        <div>
          <label>${t("geo.temp")}</label>
          <input type="number" step="1" value="${seg.temp}" data-seg="${i}" data-field="temp">
        </div>
        <div>
          <label>${t("geo.wind")}</label>
          <select data-seg="${i}" data-field="wiatr">
            <option value="brak" ${seg.wiatr === "brak" ? "selected" : ""}>${t("geo.windNone")}</option>
            <option value="umiarkowany" ${seg.wiatr === "umiarkowany" ? "selected" : ""}>${t("geo.windModerate")}</option>
            <option value="silny" ${seg.wiatr === "silny" ? "selected" : ""}>${t("geo.windStrong")}</option>
          </select>
        </div>
        <div>
          <label>${t("geo.precip")}</label>
          <select data-seg="${i}" data-field="opady">
            <option value="brak" ${seg.opady === "brak" ? "selected" : ""}>${t("geo.precipNone")}</option>
            <option value="lekkie" ${seg.opady === "lekkie" ? "selected" : ""}>${t("geo.precipLight")}</option>
            <option value="intensywne" ${seg.opady === "intensywne" ? "selected" : ""}>${t("geo.precipHeavy")}</option>
          </select>
        </div>
      `;
      segmentsContainer.appendChild(row);
    });

    segmentsContainer.querySelectorAll("[data-seg]").forEach((el) => {
      el.addEventListener("input", () => {
        const idx = Number(el.dataset.seg);
        const field = el.dataset.field;
        draftSegments[idx][field] = field === "temp" ? parseFloat(el.value) || 0 : el.value;
      });
    });
  }
  document.getElementById("f-dystans").addEventListener("input", renderSegmentInputs);

  function segmentDays(seg, length, basePace, elevFraction) {
    const modSurface = SURFACE_MOD[seg.nawierzchnia] || 0;
    const modTemp = seg.temp > 30 ? -0.15 : 0;
    const modWind = WIND_MOD[seg.wiatr] || 0;
    const modPrecip = PRECIP_MOD[seg.opady] || 0;
    const effectivePace = basePace * Math.max(0.15, 1 + modSurface + modTemp + modWind + modPrecip + elevFraction);
    return length / effectivePace;
  }
  function computeStageDays(stage) {
    const basePace = state.basePace || 110;
    const elevPenaltyKm = -1 * Math.floor(stage.przewyzszenie / 500) * 10;
    const elevFraction = elevPenaltyKm / basePace;
    return stage.segments.reduce((sum, seg) => sum + segmentDays(seg, seg.to - seg.from, basePace, elevFraction), 0);
  }

  const WIND_LABEL_KEY = { brak: "geo.windNone", umiarkowany: "geo.windModerate", silny: "geo.windStrong" };
  const PRECIP_LABEL_KEY = { brak: "geo.precipNone", lekkie: "geo.precipLight", intensywne: "geo.precipHeavy" };
  const SURFACE_LABEL_KEY = { "Asfalt": "geo.surfaceAsphalt", "Gravel": "geo.surfaceGravel", "Szuter techniczny": "geo.surfaceTechnical" };

  function renderStages() {
    stageList.innerHTML = "";
    emptyStages.classList.toggle("show", state.stages.length === 0);
    const basePace = state.basePace || 110;
    state.stages.forEach((s, i) => {
      const days = computeStageDays(s);
      const elevPenaltyKm = -1 * Math.floor(s.przewyzszenie / 500) * 10;
      const elevFraction = elevPenaltyKm / basePace;

      const card = document.createElement("div");
      card.className = "stage-card";
      card.innerHTML = `
        <div class="stage-card-main">
          <div class="stage-day-badge">${i + 1}</div>
          <div class="stage-route">
            <div class="route-line">${escapeHtml(s.start || "—")} → ${escapeHtml(s.cel || "—")}</div>
            <div class="route-sub">${s.dystans.toFixed(0)} km · ${s.segments.length} odc.</div>
          </div>
          <div class="stage-days">${days.toFixed(1)}<span class="unit">${t("geo.days")}</span></div>
          <div class="card-actions">
            <button class="stage-edit" data-idx="${i}" aria-label="edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button class="stage-del" data-idx="${i}" aria-label="delete">×</button>
          </div>
        </div>
        <div class="stage-detail">
          <div class="segment-summary">
            ${s.segments.map((seg) => {
              const d = segmentDays(seg, seg.to - seg.from, basePace, elevFraction);
              return `<div><span class="seg-tag">${seg.from}-${seg.to.toFixed(0)}km</span>${t(SURFACE_LABEL_KEY[seg.nawierzchnia])}, ${seg.temp}°C, ${t(WIND_LABEL_KEY[seg.wiatr])}, ${t(PRECIP_LABEL_KEY[seg.opady])} — ${d.toFixed(2)} ${t("geo.days")}</div>`;
            }).join("")}
          </div>
        </div>
      `;
      const main = card.querySelector(".stage-card-main");
      const detail = card.querySelector(".stage-detail");
      main.addEventListener("click", (e) => {
        if (e.target.closest(".stage-del") || e.target.closest(".stage-edit")) return;
        detail.classList.toggle("open");
      });
      card.querySelector(".stage-edit").addEventListener("click", (e) => {
        e.stopPropagation();
        openStageSheet(i);
      });
      card.querySelector(".stage-del").addEventListener("click", (e) => {
        e.stopPropagation();
        state.stages.splice(i, 1);
        save(); renderStages(); renderGear();
      });
      stageList.appendChild(card);
    });
  }

  function openStageSheet(index) {
    editingStageIndex = index;
    const titleEl = document.getElementById("sheet-stage-title");
    const submitBtn = document.getElementById("btn-add-stage");
    if (index == null) {
      titleEl.textContent = t("sheet.newStageTitle");
      submitBtn.textContent = t("geo.addStage");
      ["f-start", "f-cel", "f-dystans", "f-przewyzszenie"].forEach((id) => {
        document.getElementById(id).value = id === "f-przewyzszenie" ? 0 : "";
      });
      draftSegments = [];
      renderSegmentInputs();
    } else {
      const s = state.stages[index];
      titleEl.textContent = t("sheet.editStageTitle");
      submitBtn.textContent = t("geo.saveStage");
      document.getElementById("f-start").value = s.start || "";
      document.getElementById("f-cel").value = s.cel || "";
      document.getElementById("f-dystans").value = s.dystans;
      document.getElementById("f-przewyzszenie").value = s.przewyzszenie || 0;
      draftSegments = s.segments.map((seg) => ({ nawierzchnia: seg.nawierzchnia, temp: seg.temp, wiatr: seg.wiatr, opady: seg.opady }));
      renderSegmentInputs();
    }
    openSheet("sheet-stage");
  }

  function showFieldError(inputEl) {
    inputEl.style.borderColor = "var(--warn)";
    inputEl.focus();
    const onInput = () => { inputEl.style.borderColor = ""; inputEl.removeEventListener("input", onInput); };
    inputEl.addEventListener("input", onInput);
  }

  document.getElementById("btn-add-stage").addEventListener("click", () => {
    const dystansInput = document.getElementById("f-dystans");
    const dystans = parseFloat(dystansInput.value);
    if (!dystans || dystans <= 0) { showFieldError(dystansInput); return; }
    const ranges = segmentRanges(dystans);
    const segments = ranges.map((r, i) => {
      const d = draftSegments[i] || defaultSegment();
      return { from: r.from, to: r.to, nawierzchnia: d.nawierzchnia, temp: d.temp, wiatr: d.wiatr, opady: d.opady };
    });
    const stageData = {
      start: document.getElementById("f-start").value.trim(),
      cel: document.getElementById("f-cel").value.trim(),
      dystans,
      przewyzszenie: parseFloat(document.getElementById("f-przewyzszenie").value) || 0,
      segments,
    };
    if (editingStageIndex != null) {
      state.stages[editingStageIndex] = stageData;
    } else {
      state.stages.push(stageData);
    }
    save(); renderStages(); renderGear();
    editingStageIndex = null;
    ["f-start", "f-cel", "f-dystans", "f-przewyzszenie"].forEach((id) => {
      document.getElementById(id).value = id === "f-przewyzszenie" ? 0 : "";
    });
    draftSegments = [];
    renderSegmentInputs();
    closeSheet("sheet-stage");
  });

  // ---------------- Sprzęt (accordion) ----------------
  function renderChecklistItems(ul, ids) {
    ids.forEach((id) => {
      const checked = !!state.checklist[id];
      const li = document.createElement("li");
      const cbId = `chk-${id}`;
      li.innerHTML = `
        <input type="checkbox" id="${cbId}" ${checked ? "checked" : ""}>
        <label for="${cbId}" style="display:contents;"><span>${escapeHtml(t(`gear.item.${id}`))}</span></label>
      `;
      const cb = li.querySelector("input");
      cb.addEventListener("change", () => {
        state.checklist[id] = cb.checked;
        save();
        updateCategoryProgress(ul.closest(".gear-category"));
      });
      ul.appendChild(li);
    });
  }

  function updateCategoryProgress(catEl) {
    if (!catEl) return;
    const ids = JSON.parse(catEl.dataset.ids);
    const checkedCount = ids.filter((id) => state.checklist[id]).length;
    catEl.querySelector(".cat-progress").textContent = `${checkedCount}/${ids.length}`;
  }

  function makeAccordionCategory(key, ids, conditional, catId) {
    const wrap = document.createElement("div");
    wrap.className = "gear-category" + (conditional ? " conditional" : "");
    wrap.dataset.ids = JSON.stringify(ids);
    const isOpen = !!state.gearOpen[catId];
    if (isOpen) wrap.classList.add("open");
    wrap.innerHTML = `
      <div class="gear-category-header">
        <span class="cat-name">${t(`gear.cat.${key}`)}</span>
        <span class="cat-progress">0/${ids.length}</span>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="gear-category-body"><ul class="checklist"></ul></div>
    `;
    wrap.querySelector(".gear-category-header").addEventListener("click", () => {
      wrap.classList.toggle("open");
      state.gearOpen[catId] = wrap.classList.contains("open");
      save();
    });
    renderChecklistItems(wrap.querySelector(".checklist"), ids);
    updateCategoryProgress(wrap);
    return wrap;
  }

  function renderGear() {
    const commonContainer = document.getElementById("gear-common");
    commonContainer.innerHTML = "";
    GEAR_CATEGORY_ORDER.forEach((cat) => {
      commonContainer.appendChild(makeAccordionCategory(cat, GEAR_COMMON[cat], false, "common-" + cat));
    });

    let hasHot = false, hasCold = false, hasRain = false, hasWind = false, hasTechnical = false;
    state.stages.forEach((s) => {
      s.segments.forEach((seg) => {
        if (seg.temp > 30) hasHot = true;
        if (seg.temp < 5) hasCold = true;
        if (seg.opady && seg.opady !== "brak") hasRain = true;
        if (seg.wiatr === "silny") hasWind = true;
        if (seg.nawierzchnia === "Gravel" || seg.nawierzchnia === "Szuter techniczny") hasTechnical = true;
      });
    });
    const flags = { hot: hasHot, cold: hasCold, rain: hasRain, wind: hasWind, technical: hasTechnical };
    const recommendedContainer = document.getElementById("gear-recommended");
    recommendedContainer.innerHTML = "";
    GEAR_CONDITIONAL_ORDER.forEach((cat) => {
      if (!flags[cat]) return;
      recommendedContainer.appendChild(makeAccordionCategory(cat, GEAR_CONDITIONAL[cat], true, "cond-" + cat));
    });
  }

  // ---------------- Bezpieczeństwo ----------------
  const contactList = document.getElementById("contact-list");
  const noContactsEl = document.getElementById("no-contacts");
  const sFrequency = document.getElementById("s-frequency");
  const remindersStatus = document.getElementById("reminders-status");
  const safetyFeedback = document.getElementById("safety-feedback");
  const btnEnableReminders = document.getElementById("btn-enable-reminders");
  const btnSendNow = document.getElementById("btn-send-now");
  const messagePreview = document.getElementById("message-preview");
  const messagePreviewText = document.getElementById("message-preview-text");
  const btnCopyMessage = document.getElementById("btn-copy-message");

  sFrequency.value = state.safety.frequency || "none";
  sFrequency.addEventListener("change", () => { state.safety.frequency = sFrequency.value; save(); });

  btnCopyMessage.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(messagePreviewText.textContent);
      const original = btnCopyMessage.textContent;
      btnCopyMessage.textContent = t("safety.copied");
      setTimeout(() => { btnCopyMessage.textContent = original; }, 1500);
    } catch (e) { /* clipboard unavailable */ }
  });

  let editingContactIndex = null;

  function renderContacts() {
    contactList.innerHTML = "";
    const list = state.safety.contacts;
    noContactsEl.classList.toggle("show", list.length === 0);
    list.forEach((c, i) => {
      const card = document.createElement("div");
      card.className = "contact-card";
      const icon = c.method === "sms"
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path d="M4 5h16v14H4z"/><path d="M4 6l8 7 8-7"/></svg>`;
      card.innerHTML = `
        <div class="contact-method-icon ${c.method === "sms" ? "sms" : ""}">${icon}</div>
        <div class="contact-value">${escapeHtml(c.value)}</div>
        <div class="card-actions">
          <button class="contact-edit" data-idx="${i}" aria-label="edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="contact-del" data-idx="${i}" aria-label="delete">×</button>
        </div>
      `;
      card.querySelector(".contact-edit").addEventListener("click", () => openContactSheet(i));
      card.querySelector(".contact-del").addEventListener("click", () => {
        state.safety.contacts.splice(i, 1);
        save(); renderContacts();
      });
      contactList.appendChild(card);
    });
  }

  function openContactSheet(index) {
    editingContactIndex = index;
    const titleEl = document.getElementById("sheet-contact-title");
    const submitBtn = document.getElementById("btn-add-contact");
    const cValue = document.getElementById("c-value");
    const cMethod = document.getElementById("c-method");
    if (index == null) {
      titleEl.textContent = t("sheet.newContactTitle");
      submitBtn.textContent = t("safety.addContact");
      cValue.value = "";
      cMethod.value = "email";
    } else {
      const c = state.safety.contacts[index];
      titleEl.textContent = t("sheet.editContactTitle");
      submitBtn.textContent = t("safety.saveContact");
      cValue.value = c.value;
      cMethod.value = c.method;
    }
    openSheet("sheet-contact");
  }

  document.getElementById("btn-add-contact").addEventListener("click", () => {
    const cValue = document.getElementById("c-value");
    const cMethod = document.getElementById("c-method");
    const v = cValue.value.trim();
    if (!v) { showFieldError(cValue); return; }
    if (editingContactIndex != null) {
      state.safety.contacts[editingContactIndex] = { ...state.safety.contacts[editingContactIndex], method: cMethod.value, value: v };
    } else {
      state.safety.contacts.push({ id: "c" + Date.now() + Math.random().toString(36).slice(2, 7), method: cMethod.value, value: v });
    }
    save(); renderContacts();
    editingContactIndex = null;
    cValue.value = "";
    closeSheet("sheet-contact");
  });

  const FREQ_MS = { "1h": 3600000, "3h": 10800000, "6h": 21600000, "daily": 86400000 };
  let reminderTimer = null;

  function showFeedback(msg) { safetyFeedback.textContent = msg; safetyFeedback.style.display = "block"; }

  function updateReminderUI() {
    if (state.safety.remindersEnabled && state.safety.frequency !== "none") {
      remindersStatus.style.display = "block";
      btnEnableReminders.textContent = "✓ " + t("safety.enableReminders");
    } else {
      remindersStatus.style.display = "none";
      btnEnableReminders.textContent = t("safety.enableReminders");
    }
  }
  function startReminderLoop() {
    if (reminderTimer) clearInterval(reminderTimer);
    const ms = FREQ_MS[state.safety.frequency];
    if (!ms) return;
    reminderTimer = setInterval(() => {
      if (window.Notification && Notification.permission === "granted") {
        new Notification(t("app.title"), { body: t("safety.sendNow") + "?", icon: "icons/icon-192.png" });
      }
    }, ms);
  }
  btnEnableReminders.addEventListener("click", async () => {
    if (state.safety.frequency === "none") { showFeedback(t("safety.frequency")); return; }
    if (!state.safety.remindersEnabled) {
      if ("Notification" in window) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { showFeedback(t("safety.locationError")); return; }
      }
      state.safety.remindersEnabled = true;
      startReminderLoop();
    } else {
      state.safety.remindersEnabled = false;
      if (reminderTimer) clearInterval(reminderTimer);
    }
    save(); updateReminderUI();
  });

  async function reverseGeocode(lat, lon) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${state.lang}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      return data.city || data.locality || data.principalSubdivision || null;
    } catch (e) { return null; }
  }

  const MAX_URL_LEN = 1500;
  function chunkRecipients(values, prefixLen) {
    const chunks = []; let current = []; let currentLen = prefixLen;
    values.forEach((v) => {
      const addLen = v.length + 1;
      if (current.length && currentLen + addLen > MAX_URL_LEN) { chunks.push(current); current = []; currentLen = prefixLen; }
      current.push(v); currentLen += addLen;
    });
    if (current.length) chunks.push(current);
    return chunks;
  }

  btnSendNow.addEventListener("click", () => {
    if (state.safety.contacts.length === 0) { showFeedback(t("safety.needContact")); return; }
    if (!("geolocation" in navigator)) { showFeedback(t("safety.locationError")); return; }
    showFeedback(t("safety.locating"));
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const place = await reverseGeocode(latitude, longitude);
      const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
      const placeText = place || t("safety.messageFallback");
      const message = `${t("safety.messagePrefix")} ${placeText}. ${mapsUrl}`;

      const emails = state.safety.contacts.filter((c) => c.method === "email").map((c) => c.value);
      const phones = state.safety.contacts.filter((c) => c.method === "sms").map((c) => c.value);

      const subject = encodeURIComponent(t("app.title") + " — check-in");
      const body = encodeURIComponent(message);

      const emailChunks = chunkRecipients(emails, subject.length + body.length + 20);
      const smsChunks = chunkRecipients(phones, body.length + 10);
      const allLinks = [
        ...emailChunks.map((chunk) => `mailto:${chunk.map(encodeURIComponent).join(",")}?subject=${subject}&body=${body}`),
        ...smsChunks.map((chunk) => `sms:${chunk.map(encodeURIComponent).join(",")}?body=${body}`),
      ];
      allLinks.forEach((link, i) => { setTimeout(() => { window.location.href = link; }, i * 400); });

      messagePreviewText.textContent = message;
      messagePreview.style.display = "block";
      safetyFeedback.style.display = "none";
    }, (err) => {
      showFeedback(`${t("safety.locationError")} (${err.code}: ${err.message})`);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  });

  // ---------------- W pobliżu (Overpass API / OpenStreetMap) ----------------
  const nearbyBtn = document.getElementById("btn-nearby-search");
  const nearbyResults = document.getElementById("nearby-results");
  const nearbyEmpty = document.getElementById("nearby-empty");
  const nearbyFeedback = document.getElementById("nearby-feedback");
  const NEARBY_RADIUS_M = 5000;

  const NEARBY_CATS = [
    { key: "pharmacy", query: `node["amenity"="pharmacy"](around:${NEARBY_RADIUS_M},{lat},{lon});` },
    { key: "water", query: `node["amenity"="drinking_water"](around:${NEARBY_RADIUS_M},{lat},{lon});` },
    { key: "food", query: `node["shop"~"supermarket|convenience|bakery"](around:${NEARBY_RADIUS_M},{lat},{lon});` },
    { key: "bike", query: `node["shop"="bicycle"](around:${NEARBY_RADIUS_M},{lat},{lon});` },
    { key: "lodging", query: `node["tourism"~"camp_site|guest_house|hotel|hostel"](around:${NEARBY_RADIUS_M},{lat},{lon});` },
  ];

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function showNearbyFeedback(msg) {
    nearbyFeedback.textContent = msg;
    nearbyFeedback.style.display = msg ? "block" : "none";
  }

  async function fetchNearby(lat, lon) {
    const query = `[out:json][timeout:20];(${NEARBY_CATS.map((c) => c.query.replace("{lat}", lat).replace("{lon}", lon)).join("")});out body;`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      return data.elements || [];
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  function classifyElement(el) {
    const tags = el.tags || {};
    if (tags.amenity === "pharmacy") return "pharmacy";
    if (tags.amenity === "drinking_water") return "water";
    if (["supermarket", "convenience", "bakery"].includes(tags.shop)) return "food";
    if (tags.shop === "bicycle") return "bike";
    if (["camp_site", "guest_house", "hotel", "hostel"].includes(tags.tourism)) return "lodging";
    return null;
  }

  function renderNearby(elements, userLat, userLon) {
    nearbyResults.innerHTML = "";
    const grouped = {};
    elements.forEach((el) => {
      const cat = classifyElement(el);
      if (!cat || el.lat == null || el.lon == null) return;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(el);
    });

    const hasAny = NEARBY_CATS.some((c) => grouped[c.key] && grouped[c.key].length);
    nearbyEmpty.classList.toggle("show", !hasAny);
    if (!hasAny) { showNearbyFeedback(t("nearby.noResults")); return; }
    showNearbyFeedback("");

    NEARBY_CATS.forEach((catDef) => {
      const items = grouped[catDef.key];
      if (!items || !items.length) return;
      items.forEach((el) => {
        el._dist = haversine(userLat, userLon, el.lat, el.lon);
      });
      items.sort((a, b) => a._dist - b._dist);

      const section = document.createElement("div");
      section.className = "nearby-category";
      section.innerHTML = `<h4 class="nearby-category-title">${t(`nearby.cat.${catDef.key}`)} (${items.length})</h4>`;
      items.slice(0, 15).forEach((el) => {
        const name = (el.tags && el.tags.name) || t(`nearby.cat.${catDef.key}`).replace(/y$|i$/, "");
        const mapsUrl = `https://maps.google.com/?q=${el.lat},${el.lon}`;
        const card = document.createElement("div");
        card.className = "nearby-card";
        card.innerHTML = `
          <div class="nb-name">${escapeHtml(name)}</div>
          <div class="nb-dist">${el._dist.toFixed(1)} km</div>
          <a class="nb-nav" href="${mapsUrl}" target="_blank" rel="noopener">${t("nearby.openMaps")}</a>
        `;
        section.appendChild(card);
      });
      nearbyResults.appendChild(section);
    });
  }

  nearbyBtn.addEventListener("click", () => {
    if (!("geolocation" in navigator)) { showNearbyFeedback(t("nearby.error")); return; }
    nearbyEmpty.classList.remove("show");
    nearbyResults.innerHTML = "";
    showNearbyFeedback(t("nearby.locating"));
    nearbyBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      showNearbyFeedback(t("nearby.searching"));
      try {
        const elements = await fetchNearby(latitude, longitude);
        renderNearby(elements, latitude, longitude);
      } catch (e) {
        showNearbyFeedback(t("nearby.error"));
      } finally {
        nearbyBtn.disabled = false;
      }
    }, () => {
      showNearbyFeedback(t("nearby.error"));
      nearbyBtn.disabled = false;
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  });

  // ---------------- Init ----------------
  applyI18n();
  renderSegmentInputs();
  renderStages();
  renderGear();
  renderContacts();
  updateReminderUI();
  if (state.safety.remindersEnabled) startReminderLoop();

  // ---------------- PWA install prompt ----------------
  let deferredPrompt = null;
  const installBanner = document.getElementById("install-banner");
  const installBtn = document.getElementById("btn-install");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBanner.classList.add("show");
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBanner.classList.remove("show");
  });
  window.addEventListener("appinstalled", () => { installBanner.classList.remove("show"); });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
