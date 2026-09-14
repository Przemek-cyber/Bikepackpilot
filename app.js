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
    safety: { method: "email", contact: "", frequency: "none", remindersEnabled: false },
  };
  if (!state.safety) state.safety = { method: "email", contact: "", frequency: "none", remindersEnabled: false };
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

  // ---------------- i18n application ----------------
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPh));
    });
    document.getElementById("lang-switch").value = state.lang;
  }

  document.getElementById("lang-switch").addEventListener("change", (e) => {
    state.lang = e.target.value;
    save();
    applyI18n();
    renderSegmentInputs();
    renderStages();
    renderGear();
    renderContacts();
    updateReminderUI();
  });

  // ---------------- Tabs ----------------
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".panel");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "sprzet") renderGear();
    });
  });

  // ---------------- Geografia + Pogoda: tempo ----------------
  const stageBody = document.getElementById("stage-body");
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

  function defaultSegment() {
    return { nawierzchnia: "Asfalt", temp: 20, wiatr: "brak", opady: "brak" };
  }

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
    return stage.segments.reduce(
      (sum, seg) => sum + segmentDays(seg, seg.to - seg.from, basePace, elevFraction), 0
    );
  }

  const WIND_LABEL_KEY = { brak: "geo.windNone", umiarkowany: "geo.windModerate", silny: "geo.windStrong" };
  const PRECIP_LABEL_KEY = { brak: "geo.precipNone", lekkie: "geo.precipLight", intensywne: "geo.precipHeavy" };
  const SURFACE_LABEL_KEY = { "Asfalt": "geo.surfaceAsphalt", "Gravel": "geo.surfaceGravel", "Szuter techniczny": "geo.surfaceTechnical" };

  function renderStages() {
    stageBody.innerHTML = "";
    emptyStages.style.display = state.stages.length ? "none" : "block";
    const basePace = state.basePace || 110;
    state.stages.forEach((s, i) => {
      const days = computeStageDays(s);
      const elevPenaltyKm = -1 * Math.floor(s.przewyzszenie / 500) * 10;
      const elevFraction = elevPenaltyKm / basePace;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(s.start || "—")} → ${escapeHtml(s.cel || "—")}</td>
        <td class="num">${s.dystans.toFixed(0)} km</td>
        <td><button class="expand-btn" data-idx="${i}">${s.segments.length} ${t("geo.segDetails")}</button></td>
        <td class="num">${days.toFixed(1)} ${t("geo.days")}</td>
        <td class="del-cell"><button class="del-btn" data-idx="${i}" aria-label="delete">×</button></td>
      `;
      stageBody.appendChild(tr);

      const detailTr = document.createElement("tr");
      detailTr.className = "stage-detail-row";
      detailTr.style.display = "none";
      detailTr.innerHTML = `<td colspan="6"><div class="segment-summary">${s.segments.map((seg) => {
        const d = segmentDays(seg, seg.to - seg.from, basePace, elevFraction);
        return `<span><span class="seg-tag">${seg.from}-${seg.to.toFixed(0)}km</span> ${t(SURFACE_LABEL_KEY[seg.nawierzchnia])}, ${seg.temp}°C, ${t(WIND_LABEL_KEY[seg.wiatr])}, ${t(PRECIP_LABEL_KEY[seg.opady])} — ${d.toFixed(2)} ${t("geo.days")}</span>`;
      }).join("")}</div></td>`;
      stageBody.appendChild(detailTr);

      tr.querySelector(".expand-btn").addEventListener("click", () => {
        detailTr.style.display = detailTr.style.display === "none" ? "table-row" : "none";
      });
    });
    stageBody.querySelectorAll(".del-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.stages.splice(Number(btn.dataset.idx), 1);
        save(); renderStages(); renderGear();
      });
    });
  }

  function showFieldError(inputEl) {
    inputEl.style.borderColor = "var(--warn)";
    inputEl.focus();
    const onInput = () => {
      inputEl.style.borderColor = "";
      inputEl.removeEventListener("input", onInput);
    };
    inputEl.addEventListener("input", onInput);
  }

  document.getElementById("btn-add-stage").addEventListener("click", () => {
    const dystansInput = document.getElementById("f-dystans");
    const dystans = parseFloat(dystansInput.value);
    if (!dystans || dystans <= 0) {
      showFieldError(dystansInput);
      return;
    }
    const ranges = segmentRanges(dystans);
    const segments = ranges.map((r, i) => {
      const d = draftSegments[i] || defaultSegment();
      return { from: r.from, to: r.to, nawierzchnia: d.nawierzchnia, temp: d.temp, wiatr: d.wiatr, opady: d.opady };
    });
    state.stages.push({
      start: document.getElementById("f-start").value.trim(),
      cel: document.getElementById("f-cel").value.trim(),
      dystans,
      przewyzszenie: parseFloat(document.getElementById("f-przewyzszenie").value) || 0,
      segments,
    });
    save(); renderStages(); renderGear();
    ["f-start", "f-cel", "f-dystans", "f-przewyzszenie"].forEach((id) => {
      document.getElementById(id).value = id === "f-przewyzszenie" ? 0 : "";
    });
    draftSegments = [];
    renderSegmentInputs();
    document.getElementById("f-start").focus();
  });

  // ---------------- Sprzęt ----------------
  function renderChecklistGroup(container, ids, prefix) {
    const ul = document.createElement("ul");
    ul.className = "checklist";
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
      });
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  function renderGear() {
    const commonContainer = document.getElementById("gear-common");
    commonContainer.innerHTML = "";
    GEAR_CATEGORY_ORDER.forEach((cat) => {
      const wrap = document.createElement("div");
      wrap.className = "gear-category";
      const ids = GEAR_COMMON[cat];
      wrap.innerHTML = `<h4 class="gear-category-title">${t(`gear.cat.${cat}`)} <span class="count">${ids.length}</span></h4>`;
      commonContainer.appendChild(wrap);
      renderChecklistGroup(wrap, ids, cat);
    });

    // Aggregate weather conditions across all stages
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
    const emptyNote = document.getElementById("gear-recommended-empty");
    recommendedContainer.innerHTML = "";

    const anyTriggered = GEAR_CONDITIONAL_ORDER.some((k) => flags[k]);
    if (state.stages.length === 0) {
      emptyNote.style.display = "block";
    } else if (!anyTriggered) {
      emptyNote.style.display = "block";
    } else {
      emptyNote.style.display = "none";
      GEAR_CONDITIONAL_ORDER.forEach((cat) => {
        if (!flags[cat]) return;
        const wrap = document.createElement("div");
        wrap.className = "gear-category conditional";
        const ids = GEAR_CONDITIONAL[cat];
        wrap.innerHTML = `<h4 class="gear-category-title">${t(`gear.cat.${cat}`)}</h4>`;
        recommendedContainer.appendChild(wrap);
        renderChecklistGroup(wrap, ids, cat);
      });
    }
  }

  // ---------------- Bezpieczeństwo ----------------
  if (!Array.isArray(state.safety.contacts)) {
    state.safety.contacts = [];
    // migrate legacy single-contact shape if present
    if (state.safety.contact) {
      state.safety.contacts.push({
        id: "c" + Date.now(),
        method: state.safety.method || "email",
        value: state.safety.contact,
      });
    }
  }

  const cMethod = document.getElementById("c-method");
  const cValue = document.getElementById("c-value");
  const btnAddContact = document.getElementById("btn-add-contact");
  const contactsBody = document.getElementById("contacts-body");
  const contactsWrap = document.getElementById("contacts-wrap");
  const contactsCountEl = document.getElementById("contacts-count");
  const noContactsEl = document.getElementById("no-contacts");
  const sFrequency = document.getElementById("s-frequency");
  const remindersStatus = document.getElementById("reminders-status");
  const safetyFeedback = document.getElementById("safety-feedback");
  const btnEnableReminders = document.getElementById("btn-enable-reminders");
  const btnSendNow = document.getElementById("btn-send-now");
  const messagePreview = document.getElementById("message-preview");
  const messagePreviewText = document.getElementById("message-preview-text");
  const btnCopyMessage = document.getElementById("btn-copy-message");

  btnCopyMessage.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(messagePreviewText.textContent);
      const original = btnCopyMessage.textContent;
      btnCopyMessage.textContent = t("safety.copied");
      setTimeout(() => { btnCopyMessage.textContent = original; }, 1500);
    } catch (e) { /* clipboard unavailable — user can still select the text manually */ }
  });

  sFrequency.value = state.safety.frequency || "none";
  sFrequency.addEventListener("change", () => { state.safety.frequency = sFrequency.value; save(); });

  function renderContacts() {
    contactsBody.innerHTML = "";
    const list = state.safety.contacts;
    contactsCountEl.firstChild.textContent = `${list.length} `;
    if (list.length === 0) {
      contactsWrap.style.display = "none";
      noContactsEl.style.display = "block";
      return;
    }
    contactsWrap.style.display = "block";
    noContactsEl.style.display = "none";
    list.forEach((c, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="width:90px;"><span class="contact-method-badge ${c.method === "sms" ? "sms" : ""}">${c.method === "sms" ? t("safety.methodSms") : t("safety.methodEmail")}</span></td>
        <td>${escapeHtml(c.value)}</td>
        <td class="del-cell"><button class="del-btn" data-idx="${i}" aria-label="${t("safety.deleteContact")}">×</button></td>
      `;
      contactsBody.appendChild(tr);
    });
    contactsBody.querySelectorAll(".del-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.safety.contacts.splice(Number(btn.dataset.idx), 1);
        save(); renderContacts();
      });
    });
  }

  function addContact(method, value) {
    const v = value.trim();
    if (!v) return false;
    state.safety.contacts.push({ id: "c" + Date.now() + Math.random().toString(36).slice(2, 7), method, value: v });
    return true;
  }

  btnAddContact.addEventListener("click", () => {
    const v = cValue.value.trim();
    if (!v) { showFieldError(cValue); return; }
    addContact(cMethod.value, v);
    save(); renderContacts();
    cValue.value = "";
    cValue.focus();
  });

  const FREQ_MS = { "1h": 3600000, "3h": 10800000, "6h": 21600000, "daily": 86400000 };
  let reminderTimer = null;

  function showFeedback(msg) {
    safetyFeedback.textContent = msg;
    safetyFeedback.style.display = "block";
  }

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
    if (state.safety.frequency === "none") {
      showFeedback(t("safety.frequency"));
      sFrequency.focus();
      return;
    }
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
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${state.lang}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      return data.city || data.locality || data.principalSubdivision || null;
    } catch (e) { return null; }
  }

  // Keep generated links well under browser URL-length limits (~2000 chars);
  // batch recipients so very long contact lists open as a few drafts instead of one broken link.
  const MAX_URL_LEN = 1500;

  function chunkRecipients(values, prefixLen) {
    const chunks = [];
    let current = [];
    let currentLen = prefixLen;
    values.forEach((v) => {
      const addLen = v.length + 1;
      if (current.length && currentLen + addLen > MAX_URL_LEN) {
        chunks.push(current);
        current = [];
        currentLen = prefixLen;
      }
      current.push(v);
      currentLen += addLen;
    });
    if (current.length) chunks.push(current);
    return chunks;
  }

  btnSendNow.addEventListener("click", () => {
    if (state.safety.contacts.length === 0) {
      showFeedback(t("safety.needContact"));
      return;
    }
    if (!("geolocation" in navigator)) {
      showFeedback(t("safety.locationError"));
      return;
    }
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

      // mailto:/sms: links hand off to the OS's mail/SMS app without actually
      // navigating the page (like clicking an <a href="mailto:..."> link), so
      // location.href is the reliable trigger here — window.open() after an
      // await loses the user-activation context and gets silently popup-blocked.
      allLinks.forEach((link, i) => {
        setTimeout(() => { window.location.href = link; }, i * 400);
      });

      messagePreviewText.textContent = message;
      messagePreview.style.display = "block";
      safetyFeedback.style.display = "none";
    }, () => {
      showFeedback(t("safety.locationError"));
    }, { enableHighAccuracy: true, timeout: 8000 });
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

  window.addEventListener("appinstalled", () => {
    installBanner.classList.remove("show");
  });

  // ---------------- Service worker ----------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();
