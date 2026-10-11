// TripWise Admin Console — v3 (Full CRUD)
const API_BASE = "/api";

const ADMIN_EMAIL = "admin@tripwise.com";
const token = localStorage.getItem("tripwise_token");
if (!token) location.href = "index.html";

function decodeJWT(t) { try { return JSON.parse(atob(t.split(".")[1])); } catch { return null; } }
const _me = decodeJWT(token) || {};
const _email = String(_me.email || "").trim().toLowerCase();
if (_email !== ADMIN_EMAIL || _me.role !== "admin") {
  alert("Administrator access required.");
  location.href = "index.html";
}

const $ = id => document.getElementById(id);
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escapeAttr(s) { return String(s??"").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function formatINR(n) { return "Rs " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function formatDate(iso) { if (!iso) return "—"; try { return new Date(iso).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }); } catch { return "—"; } }
function userRef(id) { return "TW-US-" + String(id).padStart(8, "0"); }
function bookingRef(id) { return "TW-BK-" + String(id).padStart(8, "0"); }
function authHeaders() { return { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }; }

function toast(msg, kind = "info") {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.className = "toast " + kind;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => el.classList.remove("show"), 3000);
}

function openModal(id) { const el=$(id); if(!el) return; el.classList.add("active"); }
function closeModal(id) { const el=$(id); if(!el) return; el.classList.remove("active"); }

let _confirmResolve = null;
function confirmDialog(opts) {
  const o = typeof opts === "string" ? { title: "Confirm", message: opts } : opts;
  return new Promise(resolve => {
    _confirmResolve = resolve;
    $("confirmTitle").textContent = o.title || "Are you sure?";
    $("confirmMessage").textContent = o.message || "—";
    $("confirmYesBtn").textContent = o.yesLabel || "Yes";
    $("confirmNoBtn").textContent = o.noLabel || "No";
    openModal("confirmModal");
  });
}
function closeConfirm(result) {
  closeModal("confirmModal");
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

function toggleUserMenu(e) { e.stopPropagation(); $("userMenu").classList.toggle("open"); }
function closeUserMenu() { $("userMenu").classList.remove("open"); }
function logout() { localStorage.removeItem("tripwise_token"); location.href = "index.html"; }

const VIEW_META = {
  dashboard: "Dashboard", users: "Users", bookings: "Bookings", payments: "Payments",
  destinations: "Destinations", tours: "Tours", reviews: "Reviews", analytics: "Analytics",
};
function switchView(v) {
  document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
  const el = $(`view-${v}`); if (el) el.classList.add("active");
  $("crumbCurrent").textContent = VIEW_META[v] || v;
  const loaders = {
    dashboard: loadDashboard, users: loadUsers, bookings: loadBookings,
    payments: loadPayments, destinations: loadDestinations, tours: loadTours,
    reviews: loadReviews, analytics: loadAnalytics,
  };
  if (loaders[v]) loaders[v]();
}

async function loadAdminChip() {
  try {
    const r = await fetch(`${API_BASE}/profile/me`, { headers: authHeaders() });
    if (!r.ok) return;
    const u = await r.json();
    const init = (u.name || "A").slice(0, 1).toUpperCase();
    $("userAvatar").textContent = init;
    $("menuAvatar").textContent = init;
    $("userName").textContent = u.name || "Admin";
    $("menuName").textContent = u.name || "Admin";
    $("menuEmail").textContent = u.email || "—";
    $("menuRef").textContent = u.user_ref || userRef(u.user_id);
  } catch {}
}

let _users = [], _bookings = [], _destinations = [], _tours = [], _payments = [], _reviews = [];

// ═══ DASHBOARD ═══
async function loadDashboard() {
  try {
    const [uR, bR, dR, aR] = await Promise.allSettled([
      fetch(`${API_BASE}/admin/users`, { headers: authHeaders() }),
      fetch(`${API_BASE}/admin/bookings`, { headers: authHeaders() }),
      fetch(`${API_BASE}/admin/destinations`, { headers: authHeaders() }),
      fetch(`${API_BASE}/admin/analytics`, { headers: authHeaders() }),
    ]);
    const u = uR.status === "fulfilled" && uR.value.ok ? await uR.value.json() : [];
    const b = bR.status === "fulfilled" && bR.value.ok ? await bR.value.json() : [];
    const d = dR.status === "fulfilled" && dR.value.ok ? await dR.value.json() : [];
    const a = aR.status === "fulfilled" && aR.value.ok ? await aR.value.json() : null;
    $("kpiUsers").textContent = u.length;
    $("kpiBookings").textContent = b.length;
    $("kpiDestinations").textContent = d.length;
    $("kpiRevenue").textContent = a ? formatINR(a.totals?.revenue || 0) : "—";
    if ($("kpiCollected")) $("kpiCollected").textContent = a ? formatINR(a.payments?.collected || 0) : "—";
    if ($("kpiRefunded")) $("kpiRefunded").textContent = a ? String(a.payments?.refunded || 0) : "—";
    $("countUsers").textContent = u.length;
    $("countBookings").textContent = b.length;
    $("countDestinations").textContent = d.length;
  } catch { toast("Failed to load dashboard", "error"); }
}

// ═══ USERS ═══
async function loadUsers() {
  const body = $("usersBody");
  body.innerHTML = `<tr><td colspan="6" class="grid-empty">Loading…</td></tr>`;
  try {
    const r = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    _users = await r.json();
    $("countUsers").textContent = _users.length;
    renderUsers(_users);
  } catch { body.innerHTML = `<tr><td colspan="6" class="grid-empty" style="color:#dc2626">Failed</td></tr>`; }
}
function renderUsers(list) {
  const body = $("usersBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="grid-empty">No users</td></tr>`; return; }
  body.innerHTML = list.map(u => {
    const isReserved = String(u.email || "").toLowerCase() === ADMIN_EMAIL;
    return `<tr>
      <td><div class="cell-primary">${escapeHtml(u.name)}</div><div class="cell-sub">${escapeHtml(u.email)}</div></td>
      <td><span class="ref">${u.user_ref || userRef(u.user_id)}</span></td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td><span class="pill pill-${u.role}">${escapeHtml(u.role)}</span></td>
      <td>${formatDate(u.created_at)}</td>
      <td class="right"><div class="row-actions">
        <button class="row-btn" data-action="view-user" data-id="${u.user_id}">View</button>
        <button class="row-btn" data-action="edit-user" data-id="${u.user_id}">Edit</button>
        <button class="row-btn danger" data-action="delete-user" data-id="${u.user_id}" ${isReserved ? "disabled" : ""}>Delete</button>
      </div></td>
    </tr>`;
  }).join("");
}
function filterUsers() {
  const q = ($("userSearch")?.value || "").toLowerCase();
  renderUsers(_users.filter(u => (u.name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q)));
}
function openUserForm(id) {
  const u = _users.find(x => x.user_id === id);
  if (!u) return;
  $("userModalTitle").textContent = "Edit user";
  $("uFormId").value = u.user_id;
  $("uFormName").value = u.name || "";
  $("uFormEmail").value = u.email || "";
  $("uFormPhone").value = u.phone || "";
  $("uFormRole").value = u.role || "user";
  openModal("userModal");
}
async function submitUserForm(e) {
  e.preventDefault();
  const id = parseInt($("uFormId").value);
  const payload = {
    name: $("uFormName").value.trim(),
    email: $("uFormEmail").value.trim(),
    phone: $("uFormPhone").value.trim() || null,
    role: $("uFormRole").value,
  };
  try {
    const r = await fetch(`${API_BASE}/admin/users/${id}`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload),
    });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || "Failed"); }
    toast("User updated", "success");
    closeModal("userModal");
    loadUsers();
  } catch (err) { toast(err.message || "Failed to update user", "error"); }
}
async function viewUser(id) {
  try {
    const r = await fetch(`${API_BASE}/admin/users/${id}`, { headers: authHeaders() });
    const data = await r.json();
    const b = data.bookings || [];
    alert(`User: ${data.user.name}\nEmail: ${data.user.email}\nPhone: ${data.user.phone || "—"}\nRole: ${data.user.role}\nJoined: ${formatDate(data.user.created_at)}\n\nBookings: ${b.length}`);
  } catch {}
}
async function deleteUser(id) {
  const ok = await confirmDialog({ title: "Delete user?", message: `User ${userRef(id)} and all bookings removed.`, yesLabel: "Delete" });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/users/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error();
    toast("User deleted", "success");
    loadUsers();
  } catch { toast("Failed", "error"); }
}

// ═══ BOOKINGS ═══
async function loadBookings() {
  const body = $("bookingsBody");
  body.innerHTML = `<tr><td colspan="6" class="grid-empty">Loading…</td></tr>`;
  try {
    const r = await fetch(`${API_BASE}/admin/bookings`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    _bookings = await r.json();
    $("countBookings").textContent = _bookings.length;
    renderBookings(_bookings);
  } catch { body.innerHTML = `<tr><td colspan="6" class="grid-empty" style="color:#dc2626">Failed</td></tr>`; }
}
function renderBookings(list) {
  const body = $("bookingsBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="grid-empty">No bookings</td></tr>`; return; }
  body.innerHTML = list.map(b => {
    const actions = [];
    if (b.status === "pending") actions.push(`<button class="row-btn" data-action="set-status" data-id="${b.booking_id}" data-status="confirmed">Confirm</button>`);
    if (b.status !== "cancelled") actions.push(`<button class="row-btn danger" data-action="set-status" data-id="${b.booking_id}" data-status="cancelled">Cancel</button>`);
    if (b.status === "cancelled") actions.push(`<button class="row-btn" data-action="set-status" data-id="${b.booking_id}" data-status="pending">Restore</button>`);
    actions.push(`<button class="row-btn danger" data-action="delete-booking" data-id="${b.booking_id}">Delete</button>`);
    return `<tr>
      <td><span class="ref">${b.booking_ref || bookingRef(b.booking_id)}</span></td>
      <td><div class="cell-primary">${escapeHtml(b.user_name || "—")}</div><div class="cell-sub">${escapeHtml(b.email || "")}</div></td>
      <td><span class="pill pill-${b.status}">${escapeHtml(b.status)}</span></td>
      <td><span class="pill pill-${b.payment_status === "paid" ? "confirmed" : (b.payment_status === "refunded" ? "cancelled" : "pending")}">${escapeHtml(b.payment_status)}</span></td>
      <td class="right">${formatINR(b.total_price)}</td>
      <td class="right"><div class="row-actions">${actions.join("")}</div></td>
    </tr>`;
  }).join("");
}
function filterBookings() {
  const s = $("bookingFilter").value;
  renderBookings(s ? _bookings.filter(b => b.status === s) : _bookings);
}
async function setBookingStatus(id, status) {
  const ok = await confirmDialog({
    title: `Set status to ${status}?`,
    message: `Booking ${bookingRef(id)} → ${status}`,
    yesLabel: "Yes", noLabel: "No",
  });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/bookings/${id}/status`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status })
    });
    if (!r.ok) throw new Error();
    toast(`Booking ${status}`, "success");
    loadBookings();
  } catch { toast("Failed", "error"); }
}
async function deleteBooking(id) {
  const ok = await confirmDialog({ title: "Delete booking?", message: `Booking ${bookingRef(id)} will be permanently removed.`, yesLabel: "Delete" });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/bookings/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error();
    toast("Booking deleted", "success");
    loadBookings();
  } catch { toast("Failed", "error"); }
}

// ═══ PAYMENTS ═══
async function loadPayments() {
  const body = $("paymentsBody");
  body.innerHTML = `<tr><td colspan="7" class="grid-empty">Loading…</td></tr>`;
  try {
    const r = await fetch(`${API_BASE}/admin/payments`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    _payments = await r.json();
    if ($("countPayments")) $("countPayments").textContent = _payments.length;
    if (!_payments.length) { body.innerHTML = `<tr><td colspan="7" class="grid-empty">No payments</td></tr>`; return; }
    body.innerHTML = _payments.map(p => {
      const actions = [];
      if (p.status === "success") actions.push(`<button class="row-btn danger" data-action="refund" data-id="${escapeAttr(p.payment_id)}">Refund</button>`);
      return `<tr>
        <td><span class="ref">${escapeHtml(p.payment_id)}</span></td>
        <td><span class="ref">${p.booking_ref || bookingRef(p.booking_id)}</span></td>
        <td><div class="cell-primary">${escapeHtml(p.user_name || "—")}</div><div class="cell-sub">${escapeHtml(p.email || "")}</div></td>
        <td>${escapeHtml(p.method || "—")}</td>
        <td><span class="pill pill-${p.status === "success" ? "confirmed" : (p.status === "refunded" ? "cancelled" : "pending")}">${escapeHtml(p.status)}</span></td>
        <td class="right">${formatINR(p.amount)}</td>
        <td class="right"><div class="row-actions">${actions.join("")}</div></td>
      </tr>`;
    }).join("");
  } catch { body.innerHTML = `<tr><td colspan="7" class="grid-empty" style="color:#dc2626">Failed</td></tr>`; }
}
async function refundPayment(id) {
  const ok = await confirmDialog({
    title: "Refund this payment?",
    message: "The booking will be marked cancelled and payment refunded.",
    yesLabel: "Refund", noLabel: "Cancel",
  });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/payments/${id}/refund`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ reason: "admin_refund" }),
    });
    if (!r.ok) throw new Error();
    toast("Payment refunded", "success");
    loadPayments();
  } catch { toast("Failed", "error"); }
}

// ═══ DESTINATIONS ═══
async function loadDestinations() {
  const body = $("destinationsBody");
  body.innerHTML = `<tr><td colspan="6" class="grid-empty">Loading…</td></tr>`;
  try {
    const r = await fetch(`${API_BASE}/admin/destinations`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    _destinations = await r.json();
    $("countDestinations").textContent = _destinations.length;
    renderDestinations(_destinations);
  } catch { body.innerHTML = `<tr><td colspan="6" class="grid-empty" style="color:#dc2626">Failed</td></tr>`; }
}
function renderDestinations(list) {
  const body = $("destinationsBody");
  if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="grid-empty">No destinations</td></tr>`; return; }
  body.innerHTML = list.map(d => `<tr>
    <td><div class="cell-primary">${escapeHtml(d.name)}</div></td>
    <td>${escapeHtml(d.country || "")}</td>
    <td>${(d.tags||[]).slice(0,3).map(t => `<span class="pill pill-user">${escapeHtml(t)}</span>`).join(" ")}</td>
    <td class="right">${formatINR((d.avg_cost_per_day || 0) * 85)}</td>
    <td class="right">${d.rating ? "★ " + d.rating : "—"}</td>
    <td class="right"><div class="row-actions">
      <button class="row-btn" data-action="edit-dest" data-name="${escapeAttr(d.name)}">Edit</button>
      <button class="row-btn danger" data-action="delete-dest" data-name="${escapeAttr(d.name)}">Delete</button>
    </div></td>
  </tr>`).join("");
}
function openDestinationForm(name = null) {
  const d = name ? _destinations.find(x => x.name === name) : null;
  $("destModalTitle").textContent = d ? "Edit Destination" : "New Destination";
  $("dFormOriginalName").value = d ? d.name : "";
  $("dFormName").value = d?.name || "";
  $("dFormCountry").value = d?.country || "";
  $("dFormDesc").value = d?.description || "";
  $("dFormImage").value = d?.image_url || "";
  $("dFormTags").value = (d?.tags || []).join(", ");
  $("dFormTypes").value = (d?.travel_types || []).join(", ");
  $("dFormCost").value = d?.avg_cost_per_day ?? 0;
  $("dFormRating").value = d?.rating ?? 0;
  $("dFormSeason").value = d?.best_season || "";
  $("dFormLat").value = d?.lat ?? "";
  $("dFormLng").value = d?.lng ?? "";
  $("dFormNearby").value = d?.nearby ? JSON.stringify(d.nearby, null, 2) : "";
  openModal("destModal");
}
async function submitDestinationForm(e) {
  e.preventDefault();
  let nearby = [];
  try {
    const txt = $("dFormNearby").value.trim();
    if (txt) nearby = JSON.parse(txt);
    if (!Array.isArray(nearby)) throw new Error("must be an array");
  } catch (err) {
    return toast("Nearby must be valid JSON array", "error");
  }
  const payload = {
    name: $("dFormName").value.trim(),
    country: $("dFormCountry").value.trim(),
    description: $("dFormDesc").value.trim(),
    image_url: $("dFormImage").value.trim(),
    tags: $("dFormTags").value.split(",").map(s => s.trim()).filter(Boolean),
    travel_types: $("dFormTypes").value.split(",").map(s => s.trim()).filter(Boolean),
    avg_cost_per_day: parseFloat($("dFormCost").value) || 0,
    rating: parseFloat($("dFormRating").value) || 0,
    best_season: $("dFormSeason").value.trim() || null,
    lat: $("dFormLat").value ? parseFloat($("dFormLat").value) : null,
    lng: $("dFormLng").value ? parseFloat($("dFormLng").value) : null,
    nearby,
  };
  const originalName = $("dFormOriginalName").value;
  const isEdit = !!originalName;
  const url = isEdit ? `${API_BASE}/admin/destinations/${encodeURIComponent(originalName)}` : `${API_BASE}/admin/destinations`;
  try {
    const r = await fetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: authHeaders(), body: JSON.stringify(payload),
    });
    if (!r.ok) { const err = await r.json().catch(()=>({})); throw new Error(err.detail || "Failed"); }
    toast(isEdit ? "Destination updated" : "Destination created", "success");
    closeModal("destModal");
    loadDestinations();
  } catch (err) { toast(err.message || "Failed", "error"); }
}
async function deleteDestination(name) {
  const ok = await confirmDialog({ title: "Delete destination?", message: `"${name}" will be removed permanently.`, yesLabel: "Delete" });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/destinations/${encodeURIComponent(name)}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error();
    toast("Destination deleted", "success");
    loadDestinations();
  } catch { toast("Failed", "error"); }
}

// ═══ TOURS ═══
async function loadTours() {
  const body = $("toursBody");
  body.innerHTML = `<tr><td colspan="6" class="grid-empty">Loading…</td></tr>`;
  try {
    const r = await fetch(`${API_BASE}/admin/tours`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    _tours = await r.json();
    if (!_tours.length) { body.innerHTML = `<tr><td colspan="6" class="grid-empty">No tours</td></tr>`; return; }
    body.innerHTML = _tours.map(t => `<tr>
      <td><div class="cell-primary">${escapeHtml(t.name)}</div></td>
      <td>${escapeHtml(t.destination || "")}</td>
      <td>${t.duration_days || "—"}</td>
      <td class="right">${formatINR(t.price_per_person)}</td>
      <td class="right">${t.rating ? "★ " + t.rating : "—"}</td>
      <td class="right"><div class="row-actions">
        <button class="row-btn" data-action="edit-tour" data-id="${escapeAttr(t.id)}">Edit</button>
        <button class="row-btn danger" data-action="delete-tour" data-id="${escapeAttr(t.id)}">Delete</button>
      </div></td>
    </tr>`).join("");
  } catch { body.innerHTML = `<tr><td colspan="6" class="grid-empty" style="color:#dc2626">Failed</td></tr>`; }
}
function openTourForm(id = null) {
  const t = id ? _tours.find(x => String(x.id) === String(id)) : null;
  $("tourModalTitle").textContent = t ? "Edit Tour" : "New Tour";
  $("tFormId").value = t ? t.id : "";
  $("tFormName").value = t?.name || "";
  $("tFormCountry").value = t?.country || "";
  $("tFormDestination").value = t?.destination || "";
  $("tFormDesc").value = t?.description || "";
  $("tFormImage").value = t?.image_url || "";
  $("tFormDays").value = t?.duration_days ?? 3;
  $("tFormPrice").value = t?.price_per_person ?? 0;
  $("tFormRating").value = t?.rating ?? 0;
  $("tFormTags").value = (t?.tags || []).join(", ");
  $("tFormHighlights").value = (t?.highlights || []).join(", ");
  openModal("tourModal");
}
async function submitTourForm(e) {
  e.preventDefault();
  const payload = {
    name: $("tFormName").value.trim(),
    country: $("tFormCountry").value.trim(),
    destination: $("tFormDestination").value.trim(),
    description: $("tFormDesc").value.trim(),
    image_url: $("tFormImage").value.trim(),
    duration_days: parseInt($("tFormDays").value) || 3,
    price_per_person: parseFloat($("tFormPrice").value) || 0,
    rating: parseFloat($("tFormRating").value) || 0,
    tags: $("tFormTags").value.split(",").map(s => s.trim()).filter(Boolean),
    highlights: $("tFormHighlights").value.split(",").map(s => s.trim()).filter(Boolean),
  };
  const id = $("tFormId").value;
  const isEdit = !!id;
  const url = isEdit ? `${API_BASE}/admin/tours/${id}` : `${API_BASE}/admin/tours`;
  try {
    const r = await fetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: authHeaders(), body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error();
    toast(isEdit ? "Tour updated" : "Tour created", "success");
    closeModal("tourModal");
    loadTours();
  } catch { toast("Failed", "error"); }
}
async function deleteTour(id) {
  const ok = await confirmDialog({ title: "Delete tour?", message: "This tour will be removed permanently.", yesLabel: "Delete" });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/tours/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error();
    toast("Tour deleted", "success");
    loadTours();
  } catch { toast("Failed", "error"); }
}

// ═══ REVIEWS ═══
async function loadReviews() {
  const grid = $("reviewsGrid");
  grid.innerHTML = `<div class="empty-state"><h3>Loading…</h3></div>`;
  try {
    const r = await fetch(`${API_BASE}/admin/reviews`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    _reviews = await r.json();
    if (!_reviews.length) { grid.innerHTML = `<div class="empty-state"><h3>No reviews yet</h3></div>`; return; }
    grid.innerHTML = _reviews.map(r => `
      <div class="review-card">
        <div class="review-card-head">
          <div><div class="review-destination">${escapeHtml(r.destination_name || "—")}</div><div class="review-author">${escapeHtml(r.user_name || "Anon")}</div></div>
          <div class="review-stars">${"★".repeat(r.rating||0)}${"☆".repeat(5-(r.rating||0))}</div>
        </div>
        ${r.title ? `<div class="review-title">${escapeHtml(r.title)}</div>` : ""}
        <div class="review-comment">${escapeHtml(r.comment || "")}</div>
        <div class="review-actions">
          <button class="row-btn" data-action="edit-review" data-id="${escapeAttr(r.id)}">Edit</button>
          <button class="row-btn danger" data-action="delete-review" data-id="${escapeAttr(r.id)}">Delete</button>
        </div>
      </div>`).join("");
  } catch { grid.innerHTML = `<div class="empty-state"><h3>Failed</h3></div>`; }
}
function openReviewForm(id) {
  const r = _reviews.find(x => String(x.id) === String(id));
  if (!r) return;
  $("rFormId").value = r.id;
  $("rFormRating").value = r.rating || 5;
  $("rFormTitle").value = r.title || "";
  $("rFormComment").value = r.comment || "";
  openModal("reviewModal");
}
async function submitReviewForm(e) {
  e.preventDefault();
  const id = $("rFormId").value;
  const payload = {
    rating: parseInt($("rFormRating").value) || 5,
    title: $("rFormTitle").value.trim(),
    comment: $("rFormComment").value.trim(),
  };
  try {
    const r = await fetch(`${API_BASE}/admin/reviews/${id}`, {
      method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error();
    toast("Review updated", "success");
    closeModal("reviewModal");
    loadReviews();
  } catch { toast("Failed", "error"); }
}
async function deleteReview(id) {
  const ok = await confirmDialog({ title: "Delete review?", yesLabel: "Delete" });
  if (!ok) return;
  try {
    const r = await fetch(`${API_BASE}/admin/reviews/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) throw new Error();
    toast("Review deleted", "success");
    loadReviews();
  } catch { toast("Failed", "error"); }
}

// ═══ ANALYTICS ═══
async function loadAnalytics() {
  try {
    const r = await fetch(`${API_BASE}/admin/analytics`, { headers: authHeaders() });
    if (!r.ok) throw new Error();
    const data = await r.json();
    $("anBookings").textContent = data.totals?.bookings ?? 0;
    $("anConfirmed").textContent = data.totals?.confirmed ?? 0;
    $("anRevenue").textContent = formatINR(data.totals?.revenue || 0);
    if ($("anCollected")) $("anCollected").textContent = formatINR(data.payments?.collected || 0);
    if ($("topUsersBody")) {
      $("topUsersBody").innerHTML = (data.top_users || []).map(u => `
        <tr><td>#${u.rank}</td><td>${escapeHtml(u.email)}</td>
        <td class="right">${u.total_bookings}</td><td class="right">${formatINR(u.total_spent)}</td></tr>
      `).join("") || `<tr><td colspan="4" class="grid-empty">No data</td></tr>`;
    }
    renderRevenueChart();
  } catch {}
}
function renderRevenueChart() {
  const container = $("revenueChart");
  if (!container) return;
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), key: d.toISOString().slice(0, 10), value: 0 });
  }
  _bookings.forEach(b => {
    if (b.status !== "confirmed") return;
    const k = new Date(b.created_at).toISOString().slice(0, 10);
    const found = days.find(x => x.key === k);
    if (found) found.value += Number(b.total_price || 0);
  });
  const max = Math.max(...days.map(d => d.value), 1);
  if (max === 1) { container.innerHTML = `<div class="chart-empty">No confirmed revenue yet.</div>`; return; }
  container.innerHTML = days.map(d => `
    <div style="flex:1;height:100%;display:flex;align-items:flex-end;">
      <div class="bar" data-value="${formatINR(d.value)}" style="height:${Math.max((d.value/max)*100,2)}%;width:100%;">
        <span class="bar-label">${d.label.split(" ")[0]}</span>
      </div>
    </div>`).join("");
}

// ═══ EVENT DELEGATION ═══
document.addEventListener("click", e => {
  const chip = $("userChip");
  if (chip && !chip.contains(e.target)) closeUserMenu();
  if (e.target.id === "confirmYesBtn") { closeConfirm(true); return; }
  if (e.target.id === "confirmNoBtn") { closeConfirm(false); return; }

  const btn = e.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.action;
  const id = btn.dataset.id ? (isNaN(parseInt(btn.dataset.id)) ? btn.dataset.id : parseInt(btn.dataset.id)) : null;
  if (act === "view-user") viewUser(id);
  if (act === "edit-user") openUserForm(id);
  if (act === "delete-user") deleteUser(id);
  if (act === "set-status") setBookingStatus(id, btn.dataset.status);
  if (act === "delete-booking") deleteBooking(id);
  if (act === "refund") refundPayment(btn.dataset.id);
  if (act === "edit-dest") openDestinationForm(btn.dataset.name);
  if (act === "delete-dest") deleteDestination(btn.dataset.name);
  if (act === "edit-tour") openTourForm(btn.dataset.id);
  if (act === "delete-tour") deleteTour(btn.dataset.id);
  if (act === "edit-review") openReviewForm(btn.dataset.id);
  if (act === "delete-review") deleteReview(btn.dataset.id);
});

document.addEventListener("DOMContentLoaded", () => {
  loadAdminChip();
  switchView("dashboard");
});