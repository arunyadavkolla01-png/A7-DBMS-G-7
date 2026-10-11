// TripWise — Storefront (v4 — Multi-Method Payments + Itinerary Planner)
const API_BASE = "/api";
const ADMIN_EMAIL = "admin@tripwise.com";

let authToken = localStorage.getItem("tripwise_token") || null;
let allDestinations = [];
let _allTours = [];
let currentUserRef = null;
let currentUserName = "";
let currentUserEmail = "";
let _myBookings = [];
let _userPrefs = null;
let _currentTour = null;
let _currentPayment = null;
let _currentBookingId = null;
let _currentMethod = "upi";
let _lastBookingId = null, _lastBookingRef = null, _lastAmount = 0;

function $(id) { return document.getElementById(id); }

function toast(msg, kind = "info") {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.className = "toast " + kind;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => el.classList.remove("show"), 3200);
}

function openModal(id) { const el=$(id); if(!el) return; el.classList.add("active"); document.body.style.overflow="hidden"; }
function closeModal(id) { const el=$(id); if(!el) return; el.classList.remove("active"); document.body.style.overflow=""; if (id==="paymentModal") stopPaymentPolling(); }
function switchModal(from, to) { closeModal(from); setTimeout(()=>openModal(to),180); }

document.querySelectorAll(".modal-overlay").forEach(o => {
  o.addEventListener("click", e => {
    if (e.target === o && o.id !== "confirmModal") { o.classList.remove("active"); document.body.style.overflow=""; }
  });
});

let _confirmResolve = null;
function showConfirm(title, message, yesLabel="Yes", noLabel="No") {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    $("confirmTitle").textContent = title;
    $("confirmMessage").textContent = message;
    $("confirmYesBtn").textContent = yesLabel;
    $("confirmNoBtn").textContent = noLabel;
    openModal("confirmModal");
  });
}
function confirmYes() { closeModal("confirmModal"); if(_confirmResolve)_confirmResolve(true); _confirmResolve=null; }
function confirmNo()  { closeModal("confirmModal"); if(_confirmResolve)_confirmResolve(false); _confirmResolve=null; }

function decodeJWT(t) { try { return JSON.parse(atob(t.split(".")[1])); } catch { return null; } }
function isAdminEmail(e) { return String(e||"").trim().toLowerCase() === ADMIN_EMAIL; }
function escapeHtml(s) { return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escapeAttr(s) { return String(s??"").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function formatINR(a) { return "Rs " + Number(a||0).toLocaleString("en-IN",{maximumFractionDigits:0}); }
function capitalize(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ""; }
function todayISO(o=0) { const d=new Date(); d.setDate(d.getDate()+o); return d.toISOString().slice(0,10); }
function nightsBetween(a,b) { if(!a||!b) return 0; const n=Math.round((new Date(b)-new Date(a))/(864e5)); return n>0?n:0; }
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"}); }
  catch { return iso; }
}

function handleAuthFailure() {
  authToken = null;
  localStorage.removeItem("tripwise_token");
  toast("Session expired. Please sign in again.", "error");
  setTimeout(() => refreshAuthUI(), 400);
}

async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (authToken && !headers.Authorization) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) { handleAuthFailure(); throw new Error("unauthorized"); }
  return res;
}

const USD_TO_INR = 85;
const BASE_FARE_INR = 75000;
function cabinMultiplier(c) { return c==="First"?4:c==="Business"?2.6:c==="Premium Economy"?1.5:1; }

function toggleAvatarMenu() { const m=$("avatarMenu"); if(m) m.classList.toggle("open"); }
document.addEventListener("click", e => {
  const m=$("avatarMenu"), w=$("avatarWrap");
  if (!m||!w) return;
  if (!w.contains(e.target)) m.classList.remove("open");
});

function logout() {
  authToken=null; currentUserRef=null; _userPrefs=null; currentUserName=""; currentUserEmail="";
  localStorage.removeItem("tripwise_token");
  closeModal("profileModal"); closeModal("myBookingsModal");
  toast("Signed out", "success");
  refreshAuthUI();
  loadRecommendations();
}

// ─── Auth ───
async function handleRegister(e) {
  e.preventDefault();
  const name=$("regName").value.trim();
  const email=$("regEmail").value.trim();
  const phone=$("regPhone").value.trim();
  const password=$("regPassword").value;
  const confirm=$("regConfirmPassword").value;
  if (isAdminEmail(email)) return toast("Reserved email.", "error");
  if (password !== confirm) return toast("Passwords don't match", "error");
  if (password.length < 6) return toast("Password too short", "error");
  try {
    const res = await fetch(`${API_BASE}/auth/register`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({name,email,password,phone:phone||null}) });
    const data = await res.json();
    if (!res.ok) return toast(data.detail || "Registration failed", "error");
    toast("Account created. Please sign in.", "success");
    closeModal("registerModal");
    $("loginEmail").value = email;
    setTimeout(()=>{ openModal("loginModal"); $("loginPassword").focus(); }, 250);
  } catch { toast("Cannot reach server.", "error"); }
}

async function handleLogin(e) {
  e.preventDefault();
  const email=$("loginEmail").value.trim();
  const password=$("loginPassword").value;
  const form = new URLSearchParams();
  form.append("username", email); form.append("password", password);
  try {
    const res = await fetch(`${API_BASE}/auth/login`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body: form });
    const data = await res.json();
    if (!res.ok) return toast(data.detail || "Invalid credentials", "error");
    authToken = data.access_token;
    localStorage.setItem("tripwise_token", authToken);
    const p = decodeJWT(authToken) || {};
    if (isAdminEmail(p.email)) {
      toast("Welcome, Admin", "success");
      closeModal("loginModal");
      setTimeout(()=>location.href="admin.html", 400);
      return;
    }
    toast("Signed in", "success");
    closeModal("loginModal");
    await refreshAuthUI();
    await loadPreferences();
    await loadRecommendations();
  } catch { toast("Cannot reach server.", "error"); }
}

async function refreshAuthUI() {
  const btnSignin=$("btnSignin"), btnRegister=$("btnRegister"), wrap=$("avatarWrap"), avatar=$("userAvatar");
  if (!btnSignin || !btnRegister || !wrap || !avatar) return;
  if (authToken) {
    btnSignin.classList.add("hidden"); btnRegister.classList.add("hidden"); wrap.classList.remove("hidden");
    try {
      const r = await apiFetch(`/profile/me`);
      if (r.ok) {
        const u = await r.json();
        currentUserName = u.name || u.email.split("@")[0];
        currentUserEmail = u.email || "";
        currentUserRef = u.user_ref || currentUserRef;
      }
    } catch {}
    if (!currentUserName) {
      const p = decodeJWT(authToken) || {};
      currentUserName = (p.email || "User").split("@")[0];
      currentUserEmail = p.email || "";
      currentUserRef = p.sub ? `TW-US-${String(p.sub).padStart(8,"0")}` : "—";
    }
    $("menuEmail").textContent = currentUserEmail;
    $("menuName").textContent = currentUserName;
    $("menuRef").textContent = currentUserRef;
    const init = currentUserName.slice(0,1).toUpperCase();
    avatar.textContent = init;
    $("menuAvatar").textContent = init;
    avatar.onclick = e => { e.stopPropagation(); toggleAvatarMenu(); };
    $("myBookingsNavLink").classList.remove("hidden");
    $("profileNavLink").classList.remove("hidden");
  } else {
    btnSignin.classList.remove("hidden"); btnRegister.classList.remove("hidden"); wrap.classList.add("hidden");
    $("myBookingsNavLink").classList.add("hidden");
    $("profileNavLink").classList.add("hidden");
    $("avatarMenu").classList.remove("open");
  }
}

// ─── Profile ───
function openProfileModal() {
  if (!authToken) { toast("Please sign in", "error"); return openModal("loginModal"); }
  $("avatarMenu").classList.remove("open");
  openModal("profileModal");
  loadProfile();
  loadPreferences();
}
async function loadProfile() {
  if (!authToken) return;
  const p = decodeJWT(authToken) || {};
  let name = currentUserName || (p.email || "Account").split("@")[0];
  let email = currentUserEmail || p.email || "—";
  let ref = currentUserRef || "—";
  try {
    const r = await apiFetch(`/profile/me`);
    if (r.ok) { const u=await r.json(); name=u.name||name; email=u.email; ref=u.user_ref; }
  } catch {}
  $("profileName").textContent = name;
  $("profileEmail").textContent = email;
  $("profileRef").textContent = ref;
  $("profileInitials").textContent = name.slice(0,1).toUpperCase();
}
async function loadPreferences() {
  if (!authToken) return;
  try {
    const res = await apiFetch(`/profile/preferences`);
    if (!res.ok) return;
    const p = await res.json();
    _userPrefs = p;
    document.querySelectorAll('input[name="travelType"]').forEach(r => { r.checked = r.value === (p.travel_type || "solo"); });
    const set = new Set(p.interests||[]);
    document.querySelectorAll(".chip-check input").forEach(cb => { cb.checked = set.has(cb.value); });
  } catch {}
}
async function savePreferences(e) {
  e.preventDefault();
  if (!authToken) return toast("Sign in required", "error");
  const interests = [...document.querySelectorAll(".chip-check input:checked")].map(i=>i.value);
  const travelType = document.querySelector('input[name="travelType"]:checked')?.value || "solo";
  const payload = { seat_class: $("prefSeatClass").value, hotel_rating: parseInt($("prefHotelRating").value), budget_min: parseFloat($("prefBudgetMin").value)||null, budget_max: parseFloat($("prefBudgetMax").value)||null, travel_interests: interests, travel_type: travelType };
  try {
    const res = await apiFetch(`/profile/preferences`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    if (!res.ok) return toast("Failed to save", "error");
    toast("Preferences saved", "success");
    await loadPreferences();
    await loadRecommendations();
  } catch { toast("Cannot reach server", "error"); }
}

// ─── Bookings ───
function openMyBookings() {
  if (!authToken) { toast("Please sign in", "error"); return openModal("loginModal"); }
  $("avatarMenu").classList.remove("open");
  openModal("myBookingsModal");
  loadMyBookings();
}

async function loadMyBookings() {
  const list = $("myBookingsList"); if (!list) return;
  list.innerHTML = `<div class="empty-state"><h3>Loading…</h3></div>`;
  try {
    const res = await apiFetch(`/bookings/my-bookings`);
    if (!res.ok) throw new Error();
    const rows = await res.json();
    _myBookings = rows;
    if (!rows.length) { list.innerHTML = `<div class="empty-state"><h3>No bookings yet</h3></div>`; return; }
    list.innerHTML = rows.map((b, idx) => {
      const canEdit = b.status === "pending" && b.kind === "flight";
      const canCancel = b.status === "pending";
      const canReview = b.status === "confirmed" && b.destination;
      const canPay = b.payment_status !== "paid" && b.status !== "cancelled";
      const sc = b.status === "confirmed" ? "status-confirmed" : b.status === "cancelled" ? "status-cancelled" : "status-pending";
      const pc = b.payment_status === "paid" ? "paid" : "unpaid";
      const kindLabel = b.kind === "flight" ? "Flight" : b.kind === "tour" ? "Tour" : "Booking";
      const routeLine = b.kind === "flight" ? `${escapeHtml(b.origin||"—")} → ${escapeHtml(b.destination||"—")}`
        : b.kind === "tour" ? `${escapeHtml(b.tour_name||"Tour")} · ${escapeHtml(b.destination||"")}` : "—";
      const dateLine = b.depart_time ? new Date(b.depart_time).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })
        : b.tour_date ? new Date(b.tour_date).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }) : "—";
      return `
        <div class="booking-card">
          <div class="booking-card-head">
            <div><span class="ref">${escapeHtml(b.booking_ref)}</span><span style="font-size:11.5px;color:var(--ink-3);margin-left:8px;">${kindLabel}</span></div>
            <div><span class="status-pill ${sc}">${escapeHtml(b.status)}</span><span class="payment-pill ${pc}">${escapeHtml(b.payment_status || "unpaid")}</span></div>
          </div>
          <div class="booking-card-body">
            <div class="booking-card-row"><span>Details</span><strong>${routeLine}</strong></div>
            <div class="booking-card-row"><span>Date</span><strong>${dateLine}</strong></div>
            <div class="booking-card-row"><span>Total</span><strong>${formatINR(b.total_price)}</strong></div>
          </div>
          <div class="booking-card-actions">
            ${canPay ? `<button class="btn btn-primary btn-sm" data-action="pay" data-id="${b.booking_id}" data-amt="${b.total_price}">Pay now</button>` : ""}
            ${canEdit ? `<button class="btn btn-ghost btn-sm" data-action="edit" data-idx="${idx}">Edit</button>` : ""}
            ${canCancel ? `<button class="btn btn-ghost btn-sm" data-action="cancel" data-id="${b.booking_id}">Cancel</button>` : ""}
            ${canReview ? `<button class="btn btn-primary btn-sm" data-action="review" data-dest="${escapeAttr(b.destination)}" data-id="${b.booking_id}">Write review</button>` : ""}
          </div>
        </div>`;
    }).join("");

    list.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.action;
        if (act === "edit") openEditBooking(parseInt(btn.dataset.idx));
        if (act === "cancel") cancelMyBooking(parseInt(btn.dataset.id));
        if (act === "review") openReviewModal(btn.dataset.dest, parseInt(btn.dataset.id));
        if (act === "pay") openPaymentModal(parseInt(btn.dataset.id), "", parseFloat(btn.dataset.amt));
      });
    });
  } catch (e) {
    if (e.message !== "unauthorized") {
      list.innerHTML = `<div class="empty-state"><h3>Could not load bookings</h3></div>`;
    }
  }
}

async function cancelMyBooking(id) {
  const ok = await showConfirm("Cancel booking?", "This cannot be undone.", "Yes, cancel", "No");
  if (!ok) return;
  try {
    const res = await apiFetch(`/bookings/${id}/cancel`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({reason:"user"}) });
    const data = await res.json();
    if (!res.ok) return toast(data.detail || "Could not cancel", "error");
    toast("Cancelled", "success");
    loadMyBookings();
  } catch {}
}

// ─── Cards ───
function renderCard(d, opts = {}) {
  const tags = (d.tags || []).slice(0,3).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join("");
  const rating = d.rating ? `<div class="card-rating">★ ${d.rating}</div>` : "";
  const score = opts.score != null ? `<span class="score-pill">${opts.score.toFixed(2)}</span>` : "";
  const inrPerDay = Math.round((d.avg_cost_per_day || 0) * USD_TO_INR);
  return `
    <article class="card" data-dest="${escapeAttr(d.name)}">
      <div class="card-media" style="background-image:url('${escapeAttr(d.image_url||"")}')">${rating}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(d.name)} ${score}</div>
        <div class="card-country">${escapeHtml(d.country)}</div>
        <div class="card-desc">${escapeHtml(d.description || "")}</div>
        <div class="card-tags">${tags}</div>
        <div class="card-footer">
          <span class="card-price">${formatINR(inrPerDay)}<small>/day</small></span>
          <span style="font-size:12px;color:var(--ink-3)">View →</span>
        </div>
      </div>
    </article>`;
}

document.addEventListener("click", e => {
  const card = e.target.closest("#destinationsGrid .card, #recommendationsGrid .card, #searchResults .card");
  if (card) { const name = card.dataset.dest; if (name) openDestinationDetail(name); }
});

async function loadDestinations() {
  const grid = $("destinationsGrid");
  try {
    const res = await fetch(`${API_BASE}/recommendations/all`);
    if (!res.ok) throw new Error();
    allDestinations = await res.json();
    renderDestinations(allDestinations);
    loadReviews();
  } catch {
    grid.innerHTML = `<div class="empty-state"><h3>Could not load destinations</h3><p>Make sure backend runs on port 8000.</p></div>`;
  }
}
function renderDestinations(list) {
  const grid = $("destinationsGrid");
  if (!list.length) { grid.innerHTML = `<div class="empty-state"><h3>No destinations</h3></div>`; return; }
  grid.innerHTML = list.map(d => renderCard(d)).join("");
}
function filterDestinations(btn) {
  document.querySelectorAll(".filter-row .chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  const tag = btn.dataset.filter;
  if (tag === "all") return renderDestinations(allDestinations);
  renderDestinations(allDestinations.filter(d => (d.tags||[]).includes(tag)));
}

// ─── Search ───
async function runSearch() {
  const q = $("semanticQuery").value.trim(); if (!q) return;
  const section = $("search"), results = $("searchResults"), empty = $("searchEmpty");
  section.classList.remove("hidden");
  results.innerHTML = `<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>`;
  empty.classList.add("hidden");
  $("searchQueryLabel").textContent = `Results for "${q}"`;
  section.scrollIntoView({ behavior:"smooth" });

  const clientFallback = () => {
    const lower = q.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 2);
    const scored = allDestinations.map(d => {
      const hay = ((d.name||"")+" "+(d.country||"")+" "+(d.description||"")+" "+(d.tags||[]).join(" ")).toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score++;
      return { d, score };
    }).filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, 9).map(x => x.d);
    return scored;
  };

  try {
    const res = await fetch(`${API_BASE}/search/hybrid?q=${encodeURIComponent(q)}&top_k=9&alpha=0.6`);
    if (!res.ok) throw new Error();
    const hits = await res.json();
    if (!hits.length) {
      const fallback = clientFallback();
      if (fallback.length) {
        results.innerHTML = fallback.map(d => renderCard(d)).join("");
        return;
      }
      results.innerHTML = ""; empty.classList.remove("hidden"); return;
    }
    results.innerHTML = hits.map(h => `
      <article class="card" data-dest="${escapeAttr(h.destination_name)}">
        <div class="card-media" style="background-image:url('${escapeAttr(h.image_url||"")}')">
          ${h.score != null ? `<div class="card-rating">${h.score.toFixed(2)}</div>` : ""}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(h.destination_name)}</div>
          <div class="card-country">${escapeHtml(h.country||"")}</div>
          <div class="card-desc" style="-webkit-line-clamp:4">${escapeHtml(h.content)}</div>
          <div class="card-footer"><span style="font-size:12px;color:var(--ink-3)">View →</span></div>
        </div>
      </article>`).join("");
  } catch {
    const fallback = clientFallback();
    if (fallback.length) { results.innerHTML = fallback.map(d => renderCard(d)).join(""); return; }
    results.innerHTML = ""; empty.classList.remove("hidden");
  }
}
function clearSearch() { $("search").classList.add("hidden"); $("semanticQuery").value = ""; }

// ─── Recommendations ───
async function loadRecommendations() {
  const grid = $("recommendationsGrid"); if (!grid) return;
  if (!authToken) {
    grid.innerHTML = `<div class="empty-state"><h3>Sign in to see recommendations</h3><button class="btn btn-primary" onclick="openModal('loginModal')">Sign in</button></div>`;
    return;
  }
  try {
    const res = await apiFetch(`/recommendations`);
    if (!res.ok) throw new Error();
    const list = await res.json();
    if (!list.length) { grid.innerHTML = `<div class="empty-state"><h3>Set your preferences</h3></div>`; return; }
    grid.innerHTML = list.map(d => renderCard(d)).join("");
  } catch {}
}

// ─── DESTINATION DETAIL + ITINERARY ───
let _nearbyState = { destination: null, places: [], selected: new Set(), map: null, markers: [], itinerary: null };

function _mapInit(containerId, lat, lng) {
  const el = document.getElementById(containerId);
  if (!el || typeof L === "undefined") return null;
  if (_nearbyState.map) { try { _nearbyState.map.remove(); } catch {} _nearbyState.map = null; }
  _nearbyState.map = L.map(el, { zoomControl: true, attributionControl: false }).setView([lat, lng], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(_nearbyState.map);
  return _nearbyState.map;
}

function _addMarkers(map, center, places) {
  if (!map) return;
  _nearbyState.markers.forEach(m => { try { map.removeLayer(m); } catch {} });
  _nearbyState.markers = [];
  const c = L.marker([center.lat, center.lng]).addTo(map).bindPopup(`<strong>${center.name}</strong>`);
  _nearbyState.markers.push(c);

  const ordered = [...(places || [])].sort((a,b) => (a.distance_km||0) - (b.distance_km||0));

  ordered.forEach((p, i) => {
    const angle = (i / Math.max(ordered.length, 1)) * 2 * Math.PI;
    const km = p.distance_km || 5;
    const dLat = (km / 111) * Math.cos(angle);
    const dLng = (km / (111 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
    const m = L.circleMarker([center.lat + dLat, center.lng + dLng], {
      radius: 8, color: "#2563eb", fillColor: i === 0 ? "#22c55e" : (i === ordered.length - 1 ? "#ef4444" : "#60a5fa"), fillOpacity: 0.95,
    }).addTo(map).bindPopup(
      `<strong>#${i+1} ${p.name}</strong><br/>${p.description||""}<br/>${p.distance_km} km · Rs ${p.price_per_person||0}`
    );
    _nearbyState.markers.push(m);
  });

  if (ordered.length > 1) {
    const coords = ordered.map((p, i) => {
      const angle = (i / Math.max(ordered.length, 1)) * 2 * Math.PI;
      const km = p.distance_km || 5;
      const dLat = (km / 111) * Math.cos(angle);
      const dLng = (km / (111 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      return [center.lat + dLat, center.lng + dLng];
    });
    const line = L.polyline([[center.lat, center.lng], ...coords], { color: "#2563eb", weight: 2, dashArray: "6 6" }).addTo(map);
    _nearbyState.markers.push(line);
  }
}

async function openDestinationDetail(name) {
  const d = allDestinations.find(x => x.name === name);
  if (!d) return;
  openModal("destDetailModal");
  document.getElementById("ddTitle").textContent = `${d.name}, ${d.country}`;
  document.getElementById("ddSubtitle").textContent = d.description || "";
  document.getElementById("ddNearby").innerHTML = `<div class="empty-state"><h3>Loading nearby…</h3></div>`;

  _nearbyState.destination = name;
  _nearbyState.places = [];
  _nearbyState.selected.clear();
  _nearbyState.itinerary = null;

  try {
    const r = await fetch(`${API_BASE}/destinations/${encodeURIComponent(name)}/nearby`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    _nearbyState.places = (data.places || []).sort((a,b) => (a.distance_km||0) - (b.distance_km||0));

    const map = _mapInit("ddMap", data.lat || 0, data.lng || 0);
    if (map) _addMarkers(map, { lat: data.lat, lng: data.lng, name }, _nearbyState.places);

    const today = todayISO(1);
    const tomorrow = todayISO(3);
    document.getElementById("ddNearby").innerHTML = `
      <div class="itinerary-planner">
        <h3 style="margin:0 0 10px;font-size:16px;">Plan your days</h3>
        <p style="margin:0 0 14px;font-size:13px;color:var(--ink-3);">
          Pick your travel dates. We'll arrange nearby places from closest to farthest — start near your hotel, end with a final adventure.
        </p>
        <div class="grid-2" style="gap:10px;">
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:12px;">Start date</label>
            <input type="date" id="itinStart" min="${todayISO(0)}" value="${today}">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:12px;">End date</label>
            <input type="date" id="itinEnd" min="${todayISO(1)}" value="${tomorrow}">
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="clearItinerary()">Reset</button>
          <button class="btn btn-primary btn-sm" onclick="buildItinerary()">Generate plan</button>
        </div>
        <div id="itinResult" style="margin-top:14px;"></div>
      </div>
      <h3 style="margin:22px 0 10px;font-size:15px;">All nearby places (${_nearbyState.places.length})</h3>
      <div class="nearby-grid" id="ddNearbyGrid">
        ${_nearbyState.places.map((p, i) => `
          <div class="nearby-card" data-idx="${i}">
            <img src="${escapeAttr(p.image_url||'')}" onerror="this.style.display='none'">
            <div class="nearby-card-body">
              <div class="nearby-card-title">#${i+1} · ${escapeHtml(p.name)}</div>
              <div class="nearby-card-meta"><span>${p.distance_km} km</span><span>${p.duration_hours}h</span></div>
              <div class="nearby-card-desc">${escapeHtml(p.description||'')}</div>
            </div>
            <div class="nearby-card-foot">
              <span class="nearby-price">${formatINR(p.price_per_person)}</span>
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();bookThisPlace('${escapeAttr(name)}','${escapeAttr(p.name)}',${p.price_per_person||0})">Book ticket</button>
            </div>
          </div>
        `).join("")}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;">
        <button class="btn btn-ghost" onclick="closeModal('destDetailModal'); openBookingModal('${escapeAttr(name)}')">Book full trip</button>
      </div>
    `;
    setTimeout(() => map && map.invalidateSize(), 220);
  } catch (e) {
    document.getElementById("ddNearby").innerHTML = `<div class="empty-state"><h3>Could not load</h3><p>${escapeHtml(e.message||"")}</p></div>`;
  }
}

async function buildItinerary() {
  const name = _nearbyState.destination;
  if (!name) return;
  const start = document.getElementById("itinStart").value;
  const end = document.getElementById("itinEnd").value;
  if (!start || !end) return toast("Pick both dates", "error");
  if (end < start) return toast("End date must be after start", "error");

  const result = document.getElementById("itinResult");
  result.innerHTML = `<div class="empty-state" style="padding:20px;"><h3>Building plan…</h3></div>`;

  const interests = (_userPrefs?.interests || []).join(",");
  try {
    const res = await fetch(
      `${API_BASE}/destinations/${encodeURIComponent(name)}/itinerary?start=${start}&end=${end}&interests=${encodeURIComponent(interests)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const plan = await res.json();
    _nearbyState.itinerary = plan;

    if (!plan.itinerary.length) {
      result.innerHTML = `<div class="empty-state" style="padding:20px;"><h3>No places available</h3></div>`;
      return;
    }

    result.innerHTML = `
      <div class="itin-summary">
        <strong>${plan.days}-day plan</strong> · ${plan.nearby_count} places ·
        <span style="color:var(--accent-2);">${formatINR(plan.total_activity_cost)}</span> in activities
      </div>
      <div class="itin-timeline">
        ${plan.itinerary.map(day => `
          <div class="itin-day">
            <div class="itin-day-head">
              <span class="itin-day-num">Day ${day.day}</span>
              <span class="itin-day-date">${day.date ? fmtDate(day.date) : ""}</span>
              <span class="itin-day-label">${escapeHtml(day.label||"")}</span>
            </div>
            ${day.places.length === 0 ? `<div class="itin-empty">Rest / travel day</div>` : `
              <ol class="itin-places">
                ${day.places.map(p => `
                  <li>
                    <span class="itin-place-name">${escapeHtml(p.name)}</span>
                    <span class="itin-place-meta">${p.distance_km} km · ${p.duration_hours}h · ${formatINR(p.price_per_person)}</span>
                  </li>
                `).join("")}
              </ol>
            `}
            <div class="itin-day-cost">Day total: <strong>${formatINR(day.estimated_cost)}</strong></div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    result.innerHTML = `<div class="empty-state" style="padding:20px;"><h3>Could not build plan</h3><p>${escapeHtml(e.message||"")}</p></div>`;
  }
}

function clearItinerary() {
  const result = document.getElementById("itinResult");
  if (result) result.innerHTML = "";
  _nearbyState.itinerary = null;
}

async function bookThisPlace(destName, placeName, price) {
  if (!authToken) {
    toast("Please sign in first", "info");
    openModal("loginModal");
    return;
  }

  if (!_currentBookingId) {
    const ok = await showConfirm(
      "Book the trip first",
      `You need a trip booking to ${destName} before adding activities. Create one now?`,
      "Create booking", "Cancel"
    );
    if (ok) {
      closeModal("destDetailModal");
      openBookingModal(destName);
    }
    return;
  }

  try {
    const r = await apiFetch(`/bookings/${_currentBookingId}/attach-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_id: _currentBookingId,
        items: [{ place_name: placeName, price_per_person: price, day: 1 }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Failed");
    toast(`Added ${placeName} · new total ${formatINR(data.new_total)}`, "success");
  } catch (e) {
    if (e.message !== "unauthorized") toast(e.message || "Could not add", "error");
  }
}

async function openNearby(name) {
  const d = allDestinations.find(x => x.name === name);
  if (!d) return;

  _nearbyState.destination = name;
  _nearbyState.places = [];
  _nearbyState.selected.clear();

  openModal("nearbyModal");
  document.getElementById("nearbyTitle").textContent = `Around ${name}`;
  document.getElementById("nearbySubtitle").textContent = d.description || "";
  document.getElementById("nearbyGrid").innerHTML = `<div class="empty-state"><h3>Loading…</h3></div>`;
  document.getElementById("planTotal").textContent = "Rs 0";
  document.getElementById("autoPlanPreview").innerHTML = "";

  try {
    const r = await fetch(`${API_BASE}/destinations/${encodeURIComponent(name)}/nearby`);
    const data = await r.json();
    _nearbyState.places = (data.places || []).sort((a,b) => (a.distance_km||0) - (b.distance_km||0));
    const map = _mapInit("nearbyMap", data.lat, data.lng);
    if (map) _addMarkers(map, { lat: data.lat, lng: data.lng, name }, _nearbyState.places);
    document.getElementById("nearbyGrid").innerHTML = _nearbyState.places.map((p, i) => `
      <div class="nearby-card" data-idx="${i}" onclick="togglePlace(${i})">
        <img src="${escapeAttr(p.image_url||'')}" onerror="this.style.display='none'">
        <div class="nearby-card-body">
          <div class="nearby-card-title">#${i+1} · ${escapeHtml(p.name)}</div>
          <div class="nearby-card-meta"><span>${p.distance_km} km</span><span>${p.duration_hours}h</span></div>
          <div class="nearby-card-desc">${escapeHtml(p.description||'')}</div>
        </div>
        <div class="nearby-card-foot">
          <span class="nearby-price">${formatINR(p.price_per_person)}</span>
          <input type="checkbox" data-idx="${i}" onclick="event.stopPropagation();togglePlace(${i})">
        </div>
      </div>
    `).join("");
    setTimeout(() => map && map.invalidateSize(), 250);
  } catch { document.getElementById("nearbyGrid").innerHTML = `<div class="empty-state"><h3>Could not load</h3></div>`; }
}

function togglePlace(i) {
  const el = document.querySelector(`.nearby-card[data-idx="${i}"]`);
  if (!el) return;
  const cb = el.querySelector('input[type="checkbox"]');
  if (_nearbyState.selected.has(i)) _nearbyState.selected.delete(i);
  else _nearbyState.selected.add(i);
  if (cb) cb.checked = _nearbyState.selected.has(i);
  el.classList.toggle("selected", _nearbyState.selected.has(i));
  _updatePlanTotal();
}
function _updatePlanTotal() {
  let total = 0;
  for (const i of _nearbyState.selected) total += _nearbyState.places[i]?.price_per_person || 0;
  document.getElementById("planTotal").textContent = formatINR(total);
}

async function buildAutoPlan() {
  if (!_currentBookingId) return toast("Create a trip booking first", "info");
  const b = _myBookings.find(x => x.booking_id === _currentBookingId);
  const days = b && b.depart_time && b.return_time
    ? Math.max(1, Math.round((new Date(b.return_time) - new Date(b.depart_time)) / 864e5))
    : 3;
  try {
    const r = await fetch(`${API_BASE}/destinations/plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: _nearbyState.destination, days, interests: _userPrefs?.interests || [] }),
    });
    const plan = await r.json();
    document.getElementById("autoPlanPreview").innerHTML = `
      <h3 style="font-size:15px;margin-bottom:10px;">${plan.days}-day auto-plan</h3>
      ${plan.itinerary.map(d => `
        <div class="plan-day">
          <div class="plan-day-head">Day ${d.day} · ${formatINR(d.estimated_cost)}</div>
          ${d.places.length === 0 ? `<div style="font-size:12.5px;color:var(--ink-3);">Rest day</div>` : ""}
          ${d.places.map(p => `<div class="plan-place"><span>${escapeHtml(p.name)}</span><strong>${formatINR(p.price_per_person||0)}</strong></div>`).join("")}
        </div>
      `).join("")}
      <div style="font-size:13px;color:var(--ink-2);margin-top:8px;">Activity total: <strong>${formatINR(plan.total_activity_cost)}</strong></div>
    `;
    _nearbyState.selected.clear();
    const names = new Set(plan.itinerary.flatMap(d => d.places.map(p => p.name)));
    _nearbyState.places.forEach((p, i) => { if (names.has(p.name)) _nearbyState.selected.add(i); });
    document.querySelectorAll('.nearby-card').forEach(el => {
      const i = parseInt(el.dataset.idx);
      const on = _nearbyState.selected.has(i);
      el.classList.toggle("selected", on);
      const cb = el.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = on;
    });
    _updatePlanTotal();
  } catch { toast("Could not build plan", "error"); }
}

async function attachPlanToBooking() {
  if (!authToken) return toast("Sign in first", "error");
  if (!_currentBookingId) return toast("Create trip booking first", "info");
  if (!_nearbyState.selected.size) return toast("Select at least one place", "info");
  const items = [..._nearbyState.selected].map(i => ({
    place_name: _nearbyState.places[i].name,
    price_per_person: _nearbyState.places[i].price_per_person || 0,
    day: 1,
  }));
  try {
    const r = await apiFetch(`/bookings/${_currentBookingId}/attach-plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: _currentBookingId, items }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Failed");
    toast(`Added ${items.length} activities · total ${formatINR(data.new_total)}`, "success");
    closeModal("nearbyModal");
    openPaymentModal(_currentBookingId, "", data.new_total);
  } catch (e) { if (e.message !== "unauthorized") toast(e.message, "error"); }
}

// ─── FLIGHT BOOKING ───
function openBookingModal(destination) {
  if (!authToken) { toast("Sign in to book", "error"); return openModal("loginModal"); }
  const d = allDestinations.find(x => x.name === destination) || {};
  $("bookingSubtitle").textContent = `${destination}, ${d.country || ""}`;
  const perDayINR = Math.round((d.avg_cost_per_day || 0) * USD_TO_INR);
  $("bookingSummary").innerHTML = `
    <div class="row"><span>Destination</span><span>${escapeHtml(destination)}</span></div>
    <div class="row"><span>Country</span><span>${escapeHtml(d.country || "—")}</span></div>
    <div class="row"><span>Base fare</span><span>${formatINR(BASE_FARE_INR)} per passenger</span></div>
    <div class="row"><span>Daily stay</span><span>${formatINR(perDayINR)} per person</span></div>`;
  renderPersonalization(d);
  $("bookLeadName").value = currentUserName || "";
  $("bookContactEmail").value = currentUserEmail || "";
  $("bookContactPhone").value = "";
  if (_userPrefs?.seat_class) {
    const opt = [...$("bookCabin").options].find(o => o.value === _userPrefs.seat_class);
    if (opt) $("bookCabin").value = _userPrefs.seat_class;
  }
  $("bookDepartDate").value = "";
  $("bookReturnDate").value = "";
  $("bookDepartDate").min = todayISO(0);
  $("bookReturnDate").min = todayISO(1);
  $("bookPassengers").value = "1";
  $("seatsIndicator").classList.add("hidden");
  $("bookingModal").dataset.dest = destination;
  updateBookingCost();
  openModal("bookingModal");
}

function renderPersonalization(dest) {
  const box = $("personalizeBox"); if (!box) return;
  if (!_userPrefs) { box.innerHTML = ""; return; }
  const rows = [];
  rows.push(`<div class="personalize-row"><span>Travel style</span><strong>${capitalize(_userPrefs.travel_type || "solo")}</strong></div>`);
  rows.push(`<div class="personalize-row"><span>Preferred cabin</span><strong>${escapeHtml(_userPrefs.seat_class || "Economy")}</strong></div>`);
  if (_userPrefs.budget_max) rows.push(`<div class="personalize-row"><span>Budget max</span><strong>${formatINR(_userPrefs.budget_max)}</strong></div>`);
  box.innerHTML = `<div class="personalize-head">Personalized for you</div>${rows.join("")}`;
}

function updateBookingCost() {
  const depart = $("bookDepartDate").value;
  const ret = $("bookReturnDate").value;
  const passengers = parseInt($("bookPassengers").value) || 1;
  const cabin = $("bookCabin").value;
  const nights = nightsBetween(depart, ret);
  const destName = $("bookingModal").dataset.dest;
  const d = allDestinations.find(x => x.name === destName) || {};
  const dailyRate = Math.round((d.avg_cost_per_day || 0) * USD_TO_INR);
  const flightCost = BASE_FARE_INR * passengers * cabinMultiplier(cabin);
  const stayCost = dailyRate * nights * passengers;
  const total = flightCost + stayCost;
  const dd = $("durationDisplay");
  if (nights > 0) { dd.textContent = `${nights} night${nights>1?"s":""} - ${nights+1} days`; dd.classList.add("active"); }
  else { dd.textContent = "Select both dates"; dd.classList.remove("active"); }
  const cb = $("costBreakdown");
  cb.innerHTML = nights > 0 ? `
    <div class="row"><span>Flight</span><span>${formatINR(flightCost)}</span></div>
    <div class="row"><span>Stay</span><span>${formatINR(stayCost)}</span></div>
    <div class="row total"><span>Estimated</span><span>${formatINR(total)}</span></div>` :
    `<div class="empty">Select dates to see cost</div>`;
}

document.addEventListener("input", e => {
  if (["bookDepartDate","bookReturnDate","bookPassengers","bookCabin"].includes(e.target.id)) updateBookingCost();
  if (["editDepartDate","editReturnDate","editPassengers","editCabin"].includes(e.target.id)) updateEditCost();
  if (e.target.id === "tourPassengers") updateTourCost();
});
document.addEventListener("change", e => {
  if (["bookDepartDate","bookReturnDate","bookPassengers","bookCabin"].includes(e.target.id)) updateBookingCost();
  if (["editDepartDate","editReturnDate","editPassengers","editCabin"].includes(e.target.id)) updateEditCost();
});

async function handleBooking(e) {
  e.preventDefault();
  if (!authToken) return toast("Sign in required", "error");
  const departDate = $("bookDepartDate").value;
  const returnDate = $("bookReturnDate").value;
  if (!departDate || !returnDate) return toast("Both dates required", "error");
  if (returnDate <= departDate) return toast("Return must be after departure", "error");
  const passengers = parseInt($("bookPassengers").value) || 1;
  const cabin = $("bookCabin").value;
  const nights = nightsBetween(departDate, returnDate);
  const lead = $("bookLeadName").value.trim();
  const email = $("bookContactEmail").value.trim();
  const phone = $("bookContactPhone").value.trim();
  if (!lead || !email || !phone) return toast("Fill all details", "error");
  const destName = $("bookingModal").dataset.dest || "";
  const d = allDestinations.find(x => x.name === destName) || {};
  const code = (d.name || "TRV").toUpperCase().replace(/[^A-Z]/g,"").slice(0,3).padEnd(3,"X");
  const dailyRate = Math.round((d.avg_cost_per_day || 0) * USD_TO_INR);
  const total = BASE_FARE_INR * passengers * cabinMultiplier(cabin) + dailyRate * nights * passengers;
  const passengers_list = [{ name: lead, age: 30, type: "adult", email, phone, lead: true }];
  for (let i = 1; i < passengers; i++) passengers_list.push({ name: `Passenger ${i+1}`, age: 30 });
  const payload = {
    origin: "DEL", destination: code,
    depart_time: departDate + "T08:00:00",
    return_time: returnDate + "T18:00:00",
    passengers: passengers_list, price: total, currency: "INR", provider: "TripWise Airlines"
  };
  try {
    const res = await apiFetch(`/bookings/flight`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    if (!res.ok) { const err = await res.json().catch(()=>({})); return toast(err.detail || "Booking failed", "error"); }
    const data = await res.json();
    toast(`Booking created · ${data.booking_ref}`, "success");
    closeModal("bookingModal");
    _currentBookingId = data.booking_id;
    setTimeout(() => openNearby(destName), 300);
  } catch (err) { if (err.message !== "unauthorized") toast("Booking failed", "error"); }
}

// ─── TOURS ───
async function loadTours() {
  const grid = $("toursGrid"); if (!grid) return;
  try {
    const res = await fetch(`${API_BASE}/tours`);
    if (!res.ok) throw new Error();
    _allTours = await res.json();
    renderTours(_allTours);
  } catch { grid.innerHTML = `<div class="empty-state"><h3>Could not load tours</h3></div>`; }
}
function renderTours(list) {
  const grid = $("toursGrid");
  if (!list.length) { grid.innerHTML = `<div class="empty-state"><h3>No tours</h3></div>`; return; }
  grid.innerHTML = list.map(t => `
    <article class="card tour-card" data-tour-id="${escapeAttr(t.id)}">
      <div class="card-media" style="background-image:url('${escapeAttr(t.image_url)}')">
        ${t.rating ? `<div class="card-rating">★ ${t.rating}</div>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(t.name)}</div>
        <div class="card-country">${escapeHtml(t.destination)}, ${escapeHtml(t.country)}</div>
        <div class="card-desc">${escapeHtml(t.description || "")}</div>
        <div class="card-footer">
          <span class="card-price">${formatINR(t.price_per_person)}<small>/person</small></span>
          <span style="font-size:12px;color:var(--ink-3)">Book</span>
        </div>
      </div>
    </article>`).join("");
}
document.addEventListener("click", e => {
  const card = e.target.closest("#toursGrid .tour-card");
  if (!card) return;
  const id = card.dataset.tourId;
  const tour = _allTours.find(t => String(t.id) === String(id));
  if (tour) openTourBooking(tour);
});
function openTourBooking(tour) {
  if (!authToken) { toast("Sign in required", "error"); return openModal("loginModal"); }
  _currentTour = tour;
  $("tourBookingSubtitle").textContent = `${tour.name} · ${tour.destination}`;
  $("tourSummary").innerHTML = `
    <div class="row"><span>Tour</span><span>${escapeHtml(tour.name)}</span></div>
    <div class="row"><span>Duration</span><span>${tour.duration_days} days</span></div>
    <div class="row"><span>Price</span><span>${formatINR(tour.price_per_person)} /person</span></div>`;
  $("tourDate").value = "";
  $("tourDate").min = todayISO(3);
  $("tourPassengers").value = "1";
  $("tourLeadName").value = currentUserName || "";
  $("tourContactEmail").value = currentUserEmail || "";
  $("tourContactPhone").value = "";
  updateTourCost();
  openModal("tourBookingModal");
}
function updateTourCost() {
  if (!_currentTour) return;
  const pax = parseInt($("tourPassengers").value) || 1;
  const total = _currentTour.price_per_person * pax;
  $("tourCostBreakdown").innerHTML = `
    <div class="row"><span>${pax} traveler${pax>1?"s":""} × ${formatINR(_currentTour.price_per_person)}</span><span>${formatINR(total)}</span></div>
    <div class="row total"><span>Total</span><span>${formatINR(total)}</span></div>`;
}
async function handleTourBooking(e) {
  e.preventDefault();
  if (!authToken) return toast("Sign in required", "error");
  if (!_currentTour) return;
  const dateVal = $("tourDate").value;
  if (!dateVal) return toast("Pick a date", "error");
  const pax = parseInt($("tourPassengers").value) || 1;
  const lead = $("tourLeadName").value.trim();
  const email = $("tourContactEmail").value.trim();
  const phone = $("tourContactPhone").value.trim();
  if (!lead || !email || !phone) return toast("Fill all details", "error");
  const total = _currentTour.price_per_person * pax;
  const passengers = [{ name: lead, age: 30, type: "adult", email, phone, lead: true }];
  for (let i = 1; i < pax; i++) passengers.push({ name: `Traveler ${i+1}`, age: 30 });
  const payload = { tour_name: _currentTour.name, destination: _currentTour.destination, tour_date: dateVal, duration_days: _currentTour.duration_days, passengers, price: total, currency: "INR" };
  try {
    const res = await apiFetch(`/bookings/tour`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) return toast(data.detail || "Booking failed", "error");
    _currentBookingId = data.booking_id;
    closeModal("tourBookingModal");
    toast(`Booking created · ${data.booking_ref}`, "success");
    setTimeout(() => openNearby(_currentTour.destination.split(" ")[0]), 300);
  } catch (err) { if (err.message !== "unauthorized") toast("Cannot reach server", "error"); }
}

// ═══════════════════════════════════════════════════
//   PAYMENT — MULTI-METHOD SYSTEM
// ═══════════════════════════════════════════════════
let _paymentPoll = null;
function stopPaymentPolling() { if (_paymentPoll) { clearInterval(_paymentPoll); _paymentPoll = null; } }
function startPaymentPolling(id) {
  stopPaymentPolling();
  _paymentPoll = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/payments/${id}/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "success") { stopPaymentPolling(); showPaymentSuccess(data); }
    } catch {}
  }, 2000);
}
function showPaymentSuccess(data) {
  const status = $("paymentStatus");
  status.className = "payment-status show success";
  status.textContent = `Payment Successful · ${formatINR(data.amount)} · ${data.booking_ref || data.payment_id}`;
  $("paymentDoneBtn").textContent = "Paid ✓";
  $("paymentDoneBtn").disabled = true;
  toast("Payment successful!", "success");
  setTimeout(() => { closeModal("paymentModal"); openMyBookings(); }, 2000);
}

async function openPaymentModal(bookingId, bookingRef, amount) {
  if (!authToken) { toast("Sign in required", "error"); return openModal("loginModal"); }
  stopPaymentPolling();
  _currentPayment = null;
  _currentMethod = "upi";
  _lastBookingId = bookingId;
  _lastBookingRef = bookingRef;
  _lastAmount = amount;

  $("paymentAmount").textContent = formatINR(amount);
  $("paymentRef").textContent = bookingRef || "";
  $("paymentStatus").className = "payment-status";
  $("paymentStatus").textContent = "";
  $("paymentDoneBtn").disabled = false;
  $("paymentDoneBtn").textContent = "Confirm Payment";
  if ($("qrUrl")) $("qrUrl").textContent = "";
  if ($("paymentMethodPanel")) $("paymentMethodPanel").innerHTML = "";
  openModal("paymentModal");

  renderPaymentMethods();
  selectPaymentMethod("upi");
}

function renderPaymentMethods() {
  const wrap = $("paymentMethods");
  if (!wrap) return;
  wrap.innerHTML = `
    <button class="pm-tab ${_currentMethod==='upi'?'active':''}" onclick="selectPaymentMethod('upi')">📱 UPI / QR</button>
    <button class="pm-tab ${_currentMethod==='card'?'active':''}" onclick="selectPaymentMethod('card')">💳 Card</button>
    <button class="pm-tab ${_currentMethod==='netbanking'?'active':''}" onclick="selectPaymentMethod('netbanking')">🏦 NetBanking</button>
    <button class="pm-tab ${_currentMethod==='wallet'?'active':''}" onclick="selectPaymentMethod('wallet')">👛 Wallet</button>
  `;
}

function selectPaymentMethod(method) {
  _currentMethod = method;
  renderPaymentMethods();
  const panel = $("paymentMethodPanel");
  if (!panel) return;
  panel.innerHTML = "";
  $("paymentDoneBtn").disabled = false;
  $("paymentDoneBtn").textContent = "Confirm Payment";
  $("paymentStatus").className = "payment-status";
  $("paymentStatus").textContent = "";

  if (method === "upi") {
    panel.innerHTML = `<div class="qr-container" id="qrContainer"><div class="qr-skeleton">Generating QR…</div></div>
      <p class="qr-hint">Scan with any UPI app (GPay, PhonePe, Paytm).</p>
      <div class="qr-url" id="qrUrl"></div>`;
    initPaymentMethod("upi");
  } else if (method === "card") {
    panel.innerHTML = `
      <div class="field"><label>Card number</label><input id="cardNumber" placeholder="4242 4242 4242 4242" maxlength="19" inputmode="numeric"></div>
      <div class="grid-2">
        <div class="field"><label>Expiry</label><input id="cardExpiry" placeholder="MM/YY" maxlength="5"></div>
        <div class="field"><label>CVV</label><input id="cardCvv" type="password" maxlength="4" placeholder="123" inputmode="numeric"></div>
      </div>
      <div class="field"><label>Name on card</label><input id="cardName" placeholder="ARUN YADAV"></div>`;
    initPaymentMethod("card");
  } else if (method === "netbanking") {
    panel.innerHTML = `<div class="field"><label>Select bank</label><select id="bankSelect"><option>Loading…</option></select></div>
      <p class="qr-hint" style="margin-top:10px;">You'll be redirected to your bank's secure page (simulated).</p>`;
    initPaymentMethod("netbanking");
  } else if (method === "wallet") {
    panel.innerHTML = `
      <div class="field"><label>Choose wallet</label>
        <select id="walletSelect">
          <option>Paytm</option><option>PhonePe</option><option>Amazon Pay</option>
          <option>Mobikwik</option><option>Freecharge</option>
        </select>
      </div>`;
    initPaymentMethod("wallet");
  }
}

async function initPaymentMethod(method) {
  try {
    const originUrl = `${window.location.protocol}//${window.location.hostname}${window.location.port ? ":" + window.location.port : ""}`;
    const res = await apiFetch(`/payments/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: _lastBookingId, method, origin_url: originUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Payment init failed");
    _currentPayment = data;
    $("paymentAmount").textContent = formatINR(data.amount);
    $("paymentRef").textContent = data.booking_ref || _lastBookingRef;

    if (method === "upi" && $("qrContainer")) {
      $("qrContainer").innerHTML = `<img src="${data.qr_data_url}" alt="Scan" />`;
      if ($("qrUrl")) $("qrUrl").textContent = data.pay_url || "";
    }
    if (method === "netbanking" && data.banks && $("bankSelect")) {
      $("bankSelect").innerHTML = data.banks.map(b => `<option>${b}</option>`).join("");
    }
    startPaymentPolling(data.payment_id);
  } catch (err) {
    const panel = $("paymentMethodPanel");
    if (panel) panel.innerHTML = `<div class="qr-skeleton" style="color:#dc2626;padding:20px;text-align:center;">Could not load: ${escapeHtml(err.message)}</div>`;
  }
}

async function simulatePayment() {
  if (!_currentPayment) return toast("Payment not ready", "error");
  $("paymentDoneBtn").disabled = true;
  $("paymentDoneBtn").textContent = "Verifying…";

  let detail = "simulated";
  if (_currentMethod === "card" && $("cardNumber")) {
    const num = ($("cardNumber").value || "4242424242424242").replace(/\s/g, "");
    if (num.length < 12) {
      $("paymentDoneBtn").disabled = false;
      $("paymentDoneBtn").textContent = "Confirm Payment";
      return toast("Enter a valid card number", "error");
    }
    detail = num.slice(-4);
  }
  if (_currentMethod === "netbanking" && $("bankSelect")) detail = $("bankSelect").value;
  if (_currentMethod === "wallet" && $("walletSelect")) detail = $("walletSelect").value;

  try {
    const res = await fetch(`${API_BASE}/payments/${_currentPayment.payment_id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method_detail: detail }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Payment failed");
    stopPaymentPolling();
    showPaymentSuccess(data);
  } catch (err) {
    const status = $("paymentStatus");
    status.className = "payment-status show error";
    status.textContent = err.message || "Payment failed";
    $("paymentDoneBtn").disabled = false;
    $("paymentDoneBtn").textContent = "Retry";
  }
}

// Format card number input
document.addEventListener("input", e => {
  if (e.target.id === "cardNumber") {
    let v = e.target.value.replace(/\D/g, "").slice(0, 16);
    e.target.value = v.replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  if (e.target.id === "cardExpiry") {
    let v = e.target.value.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    e.target.value = v;
  }
  if (e.target.id === "cardCvv") {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
  }
});

// ─── EDIT BOOKING ───
function openEditBooking(index) {
  const b = _myBookings[index]; if (!b) return;
  $("editBookingId").value = b.booking_id;
  $("editDestination").value = b.destination || "";
  $("editBookingSummary").innerHTML = `
    <div class="row"><span>Reference</span><span>${escapeHtml(b.booking_ref)}</span></div>
    <div class="row"><span>Current total</span><span>${formatINR(b.total_price)}</span></div>`;
  if (b.depart_time) $("editDepartDate").value = new Date(b.depart_time).toISOString().slice(0,10);
  if (b.return_time) $("editReturnDate").value = new Date(b.return_time).toISOString().slice(0,10);
  $("editPassengers").value = 1;
  updateEditCost();
  closeModal("myBookingsModal");
  openModal("editBookingModal");
}
function updateEditCost() {
  const depart = $("editDepartDate").value;
  const ret = $("editReturnDate").value;
  const pax = parseInt($("editPassengers").value) || 1;
  const cabin = $("editCabin").value;
  const nights = nightsBetween(depart, ret);
  const code = ($("editDestination").value || "TRV").toUpperCase();
  const destName = allDestinations.find(x => {
    const c = (x.name||"").toUpperCase().replace(/[^A-Z]/g,"").slice(0,3).padEnd(3,"X");
    return c === code;
  })?.name;
  const d = allDestinations.find(x => x.name === destName) || {};
  const dailyRate = Math.round((d.avg_cost_per_day || 0) * USD_TO_INR);
  const flightCost = BASE_FARE_INR * pax * cabinMultiplier(cabin);
  const stayCost = dailyRate * nights * pax;
  const total = flightCost + stayCost;
  const dd = $("editDurationDisplay");
  if (nights > 0) { dd.textContent = `${nights} night${nights>1?"s":""}`; dd.classList.add("active"); }
  else { dd.textContent = "Select both dates"; dd.classList.remove("active"); }
  $("editCostBreakdown").innerHTML = nights > 0 ? `
    <div class="row"><span>Flight</span><span>${formatINR(flightCost)}</span></div>
    <div class="row"><span>Stay</span><span>${formatINR(stayCost)}</span></div>
    <div class="row total"><span>Updated</span><span>${formatINR(total)}</span></div>` :
    `<div class="empty">Select dates</div>`;
}
async function submitEditBooking(e) {
  e.preventDefault();
  if (!authToken) return toast("Sign in required", "error");
  const id = parseInt($("editBookingId").value);
  const departDate = $("editDepartDate").value;
  const returnDate = $("editReturnDate").value;
  if (!departDate || !returnDate) return toast("Both dates required", "error");
  if (returnDate <= departDate) return toast("Return after departure", "error");
  const pax = parseInt($("editPassengers").value) || 1;
  const cabin = $("editCabin").value;
  const nights = nightsBetween(departDate, returnDate);
  const code = ($("editDestination").value || "TRV").toUpperCase();
  const destName = allDestinations.find(x => {
    const c = (x.name||"").toUpperCase().replace(/[^A-Z]/g,"").slice(0,3).padEnd(3,"X");
    return c === code;
  })?.name;
  const d = allDestinations.find(x => x.name === destName) || {};
  const dailyRate = Math.round((d.avg_cost_per_day || 0) * USD_TO_INR);
  const total = BASE_FARE_INR * pax * cabinMultiplier(cabin) + dailyRate * nights * pax;
  const payload = { depart_time: departDate+"T08:00:00", return_time: returnDate+"T18:00:00", passengers: Array.from({length:pax},(_,i)=>({name:`Passenger ${i+1}`,age:30})), price: total, currency: "INR" };
  try {
    const res = await apiFetch(`/bookings/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) return toast(data.detail || "Could not update", "error");
    toast("Booking updated", "success");
    closeModal("editBookingModal");
    setTimeout(() => openMyBookings(), 300);
  } catch {}
}

// ─── REVIEWS ───
let _reviewRating = 5;
function openReviewModal(destination, bookingId) {
  if (!destination || destination === "null") { toast("No destination linked", "error"); return; }
  $("reviewSubtitle").textContent = destination;
  $("reviewDestination").value = destination;
  $("reviewBookingId").value = bookingId || "";
  $("reviewTitle").value = "";
  $("reviewComment").value = "";
  _reviewRating = 5;
  updateStarRow();
  closeModal("myBookingsModal");
  openModal("reviewModal");
}
function updateStarRow() {
  document.querySelectorAll("#starRow .star").forEach(s => {
    s.classList.toggle("active", parseInt(s.dataset.value) <= _reviewRating);
  });
  $("reviewRating").value = _reviewRating;
}
document.addEventListener("click", e => { if (e.target.matches("#starRow .star")) { _reviewRating = parseInt(e.target.dataset.value); updateStarRow(); } });
async function submitReview(e) {
  e.preventDefault();
  if (!authToken) return toast("Sign in required", "error");
  const payload = { destination_name: $("reviewDestination").value, rating: _reviewRating, title: $("reviewTitle").value.trim(), comment: $("reviewComment").value.trim(), booking_id: parseInt($("reviewBookingId").value) || null };
  try {
    const res = await apiFetch(`/reviews`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) return toast(data.detail || "Could not submit", "error");
    toast("Review published!", "success");
    closeModal("reviewModal");
    loadReviews();
  } catch {}
}
async function loadReviews() {
  const grid = $("reviewsGrid"); if (!grid || !allDestinations.length) return;
  try {
    const dests = allDestinations.slice(0,8);
    const results = await Promise.all(dests.map(d => fetch(`${API_BASE}/reviews/${encodeURIComponent(d.name)}`).then(r => r.ok ? r.json() : []).then(list => list.map(x => ({...x, destination: d.name}))).catch(() => [])));
    const all = results.flat();
    const recent = all.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,6);
    if (!recent.length) { grid.innerHTML = `<div class="empty-state"><h3>No reviews yet</h3></div>`; return; }
    grid.innerHTML = recent.map(r => `
      <div class="review-card">
        <div class="review-card-head">
          <div>
            <div class="review-destination">${escapeHtml(r.destination)}</div>
            <div class="review-author">${escapeHtml(r.user_name)}</div>
          </div>
          <div class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5-r.rating)}</div>
        </div>
        ${r.title ? `<div class="review-title">${escapeHtml(r.title)}</div>` : ""}
        <div class="review-comment">${escapeHtml(r.comment)}</div>
      </div>`).join("");
  } catch { grid.innerHTML = `<div class="empty-state"><h3>Could not load reviews</h3></div>`; }
}

// ─── CHATBOT ───
function toggleChatbot() {
  const win = $("chatbotWindow");
  win.classList.toggle("hidden");
  if (!win.classList.contains("hidden") && !$("chatbotMessages").children.length) {
    addChatMessage("bot", "Hi! I'm the TripWise assistant.\n\nAsk me:\n• How do I login?\n• How to book a trip?\n• How to see nearby places?\n• What destinations are available?");
  }
}
function addChatMessage(sender, text) {
  const c = $("chatbotMessages");
  const div = document.createElement("div");
  div.className = `msg ${sender}`;
  div.textContent = text;
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}
async function sendChatMessage() {
  const input = $("chatbotInput");
  const msg = input.value.trim(); if (!msg) return;
  input.value = "";
  addChatMessage("user", msg);
  const typing = document.createElement("div");
  typing.className = "msg bot"; typing.textContent = "…";
  $("chatbotMessages").appendChild(typing);
  $("chatbotMessages").scrollTop = 99999;
  try {
    const res = await fetch(`${API_BASE}/search/chat`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ message: msg, history: [] }) });
    const data = await res.json();
    typing.remove();
    addChatMessage("bot", data.reply || "Sorry, I couldn't answer.");
  } catch {
    typing.remove();
    addChatMessage("bot", "Connection error.");
  }
}

// ─── BOOT ───
(function boot() {
  if (authToken) {
    const p = decodeJWT(authToken) || {};
    if (isAdminEmail(p.email)) { window.location.replace("admin.html"); return; }
  }
  refreshAuthUI();
  loadDestinations();
  loadTours();
  if (authToken) { loadPreferences(); loadRecommendations(); }
})();