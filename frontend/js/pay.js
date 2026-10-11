const API_BASE = "/api";

const token = new URLSearchParams(window.location.search).get("token");

function $(id) { return document.getElementById(id); }
function toast(msg, kind = "info") {
  const el = $("toast"); if (!el) return;
  el.textContent = msg; el.className = "toast " + kind;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => el.classList.remove("show"), 3200);
}
function formatINR(n) { return "Rs " + Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:0}); }

async function loadPayment() {
  if (!token) {
    $("payAmount").textContent = "—";
    $("payRef").textContent = "Invalid payment link";
    $("btnPay").disabled = true;
    $("btnLater").disabled = true;
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/payments/${token}/status`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    $("payAmount").textContent = formatINR(data.amount);
    $("payRef").textContent = data.booking_ref || token;
    if (data.status === "success") showSuccess(data);
  } catch {
    $("payAmount").textContent = "—";
    $("payRef").textContent = "Payment not found";
    $("btnPay").disabled = true;
    $("btnLater").disabled = true;
  }
}

async function completePayment() {
  if (!token) return;
  $("btnPay").disabled = true;
  $("btnLater").disabled = true;
  $("btnPay").textContent = "Processing…";
  try {
    const res = await fetch(`${API_BASE}/payments/${token}/simulate`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Payment failed");
    showSuccess(data);
  } catch (err) {
    $("btnPay").textContent = "Retry Payment";
    $("btnPay").disabled = false;
    $("btnLater").disabled = false;
    const status = $("payStatus");
    status.className = "pay-status error show";
    status.textContent = err.message || "Payment failed.";
  }
}

function showSuccess(data) {
  const card = $("payCard");
  card.classList.add("success-screen");
  card.innerHTML = `
    <div class="success-icon">
      <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>
      </svg>
    </div>
    <h2 class="success-title">Payment Successful</h2>
    <p class="success-amount">${formatINR(data.amount)}</p>
    <p class="success-ref">${data.booking_ref || token}</p>
    <p class="success-note">Your booking is confirmed.</p>
  `;
  toast("Payment completed!", "success");
}

async function payLater() {
  if (!token) return;
  try { await fetch(`${API_BASE}/payments/${token}/pay-later`, { method: "POST" }); } catch {}
  const card = $("payCard");
  card.classList.add("later-screen");
  card.innerHTML = `
    <div class="later-icon">
      <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#d97706" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="7" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>
    </div>
    <h2 class="later-title">Payment Postponed</h2>
    <p class="later-note">You can pay later from <strong>My Bookings</strong>.</p>
    <a href="index.html" class="btn btn-primary" style="margin-top:22px;display:inline-flex;">Back to TripWise</a>
  `;
  toast("Postponed", "info");
}

loadPayment();