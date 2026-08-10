// ==========================================================================
// GoTracka v2.0 — rider.js
// Rider active delivery engine.
// Writes to the SAME Firestore schema as the original app — no schema changes.
// GPS location → riderLocation, status updates, trackingHistory.
// ==========================================================================

import { db, auth } from "./firebase-config.js";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Grab code from session ───────────────────────────────────────────────────
const code       = sessionStorage.getItem("gotracka.riderCode");
const riderPhone = sessionStorage.getItem("gotracka.riderPhone") || "";
const riderId    = sessionStorage.getItem("gotracka.riderId")    || "";

if (!code) {
  window.location.replace("index.html");
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const pillCode      = document.getElementById("pillCode");
const pillStatus    = document.getElementById("pillStatus");
const gpsLabel      = document.getElementById("gpsLabel");
const primaryBtn    = document.getElementById("primaryBtn");
const btnCantDeliver= document.getElementById("btn-cant-deliver");
const btnNav        = document.getElementById("btn-nav");
const infoPkg       = document.getElementById("infoPkg");
const infoBuyer     = document.getElementById("infoBuyer");
const infoAddr      = document.getElementById("infoAddr");
const toast         = document.getElementById("toast");

// Stage bubbles
const stages = {
  collect:   document.getElementById("stage-collect"),
  transit:   document.getElementById("stage-transit"),
  nearby:    document.getElementById("stage-nearby"),
  delivered: document.getElementById("stage-delivered"),
};

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map("riderMap", { zoomControl: false }).setView([6.5244, 3.3792], 15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors", maxZoom: 19,
}).addTo(map);
L.control.zoom({ position: "topright" }).addTo(map);

let riderMarker = null;
let destMarker  = null;

function buildRiderIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative">
      <div style="position:absolute;inset:-6px;border-radius:50%;background:rgba(59,130,246,0.25);animation:pulse-ring 1.8s ease-out infinite"></div>
      <div style="width:22px;height:22px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 2px 12px rgba(59,130,246,0.6)"></div>
    </div>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
  });
}
function buildDestIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative">
      <div style="position:absolute;inset:-12px;border-radius:50%;border:2px solid rgba(163,255,87,0.35);animation:pulse-ring 2.2s ease-out infinite"></div>
      <div style="width:16px;height:16px;border-radius:50%;background:#A3FF57;border:3px solid #fff;box-shadow:0 2px 12px rgba(163,255,87,0.5)"></div>
    </div>`,
    iconSize:   [16, 16],
    iconAnchor: [8, 8],
  });
}

// ── Toast notification ────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

// ── Stage UI helper ───────────────────────────────────────────────────────────
function setStages(doneList, activeKey) {
  const keys = ["collect", "transit", "nearby", "delivered"];
  keys.forEach(k => {
    const el = stages[k];
    el.className = "stage-bubble";
    if (doneList.includes(k))    el.classList.add("done");
    else if (k === activeKey)    el.classList.add("active");
    else                         el.classList.add("pending");
  });
}

// ── Firestore helpers ─────────────────────────────────────────────────────────
const deliveryRef = doc(db, "deliveries", code);

async function writeLocation(lat, lng) {
  try {
    await updateDoc(deliveryRef, {
      riderLocation: { lat, lng },
      trackingActive: true,
    });
  } catch (e) { console.warn("Location write failed:", e); }
}

async function addHistory(event) {
  await updateDoc(deliveryRef, {
    trackingHistory: arrayUnion({ event, at: Date.now() }),
  });
}

async function setStatus(status, extras = {}) {
  await updateDoc(deliveryRef, { status, ...extras });
}

// ── Primary button state machine ──────────────────────────────────────────────
let currentStage  = "idle"; // idle | collected | in_transit | arrived | delivered | ended
let buyerLocation = null;

function configureButton(stage) {
  currentStage = stage;
  primaryBtn.disabled = false;

  switch (stage) {
    case "idle":
      primaryBtn.textContent = "📦  I've Collected the Package";
      primaryBtn.className   = "primary-action collect";
      setStages([], "collect");
      pillStatus.textContent = "Collecting";
      break;

    case "collected":
      primaryBtn.textContent = "🚀  Start Delivery (Share Location)";
      primaryBtn.className   = "primary-action collect";
      setStages(["collect"], "transit");
      pillStatus.textContent = "Ready to transit";
      break;

    case "in_transit":
      primaryBtn.textContent = "📍  I'm Near the Delivery Address";
      primaryBtn.className   = "primary-action arrive";
      setStages(["collect", "transit"], "nearby");
      pillStatus.textContent = "In transit";
      break;

    case "arrived":
      primaryBtn.textContent = "🏡  Package Delivered Successfully";
      primaryBtn.className   = "primary-action deliver";
      setStages(["collect", "transit", "nearby"], "delivered");
      pillStatus.textContent = "Almost there!";
      break;

    case "delivered":
      primaryBtn.textContent = "✅  End Tracking";
      primaryBtn.className   = "primary-action ended";
      setStages(["collect", "transit", "nearby", "delivered"], null);
      pillStatus.textContent = "Delivered ✓";
      break;

    case "ended":
      primaryBtn.textContent = "Tracking ended — great job! 🎉";
      primaryBtn.className   = "primary-action ended";
      primaryBtn.disabled    = true;
      pillStatus.textContent = "Complete";
      stopGPS();
      // Increment completed count
      const prev = parseInt(sessionStorage.getItem("gotracka.completed") || "0");
      sessionStorage.setItem("gotracka.completed", prev + 1);
      showToast("Delivery complete! Returning to dashboard in 4s…", 4000);
      setTimeout(() => { window.location.replace("dashboard.html"); }, 4000);
      break;
  }
}

primaryBtn.addEventListener("click", async () => {
  primaryBtn.disabled = true;
  primaryBtn.textContent = "Updating…";

  try {
    switch (currentStage) {

      case "idle":
        // Rider collected the package → status = accepted
        await setStatus("accepted", { riderId, riderPhone });
        await addHistory("accepted");
        configureButton("collected");
        showToast("✅ Package collected! Start sharing location when ready.");
        break;

      case "collected":
        // Start GPS + set in_transit
        startGPS();
        await setStatus("in_transit", { trackingActive: true });
        await addHistory("in_transit");
        configureButton("in_transit");
        showToast("📡 Live location sharing started.");
        break;

      case "in_transit":
        // Rider arrived near delivery address
        await updateDoc(deliveryRef, { hasArrived: true });
        await addHistory("arrived_in_range");
        configureButton("arrived");
        showToast("📍 Great — the customer has been notified you're nearby.");
        break;

      case "arrived":
        // Package delivered
        await setStatus("delivered");
        await addHistory("package_delivered");
        configureButton("delivered");
        showToast("🎉 Delivered! You can end tracking when ready.");
        break;

      case "delivered":
        // End tracking
        await updateDoc(deliveryRef, { trackingActive: false });
        await addHistory("tracking_ended");
        configureButton("ended");
        break;
    }
  } catch (e) {
    console.error(e);
    showToast("⚠️ Something went wrong — please try again.");
    configureButton(currentStage); // Re-enable
  }
});

// ── Unable to deliver ─────────────────────────────────────────────────────────
btnCantDeliver.addEventListener("click", async () => {
  if (!confirm("Mark this delivery as unable to complete and end tracking?")) return;
  try {
    await setStatus("failed", { trackingActive: false });
    await addHistory("tracking_ended");
    stopGPS();
    showToast("Delivery marked as unsuccessful. Returning to dashboard…", 3500);
    setTimeout(() => { window.location.replace("dashboard.html"); }, 3500);
  } catch (e) { showToast("Could not update — try again."); }
});

// ── Open in Maps ──────────────────────────────────────────────────────────────
btnNav.addEventListener("click", () => {
  if (!buyerLocation) { showToast("No delivery address saved for this delivery."); return; }
  const { lat, lng } = buyerLocation;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  window.open(url, "_blank");
});

// ── Quick messages ────────────────────────────────────────────────────────────
document.querySelectorAll(".msg-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const msg = chip.dataset.msg;
    // In a real app, write to Firestore messages sub-collection.
    // For now, just copy to clipboard and animate.
    navigator.clipboard?.writeText(msg).catch(() => {});
    chip.classList.add("sent");
    chip.textContent = "✓ Copied";
    setTimeout(() => {
      chip.classList.remove("sent");
      chip.textContent = chip.dataset.originalText || chip.dataset.msg.slice(0, 24) + "…";
    }, 2000);
    showToast("📋 Message copied — send it to the customer.");
  });
  // Save original text for restore
  chip.dataset.originalText = chip.textContent;
});

// ── GPS broadcasting ──────────────────────────────────────────────────────────
let gpsWatchId = null;
let lastWriteTime = 0;
const WRITE_INTERVAL_MS = 4000; // write to Firestore at most every 4s

function startGPS() {
  if (!navigator.geolocation) {
    gpsLabel.textContent = "GPS not available on this device";
    return;
  }
  gpsLabel.textContent = "Sharing live location…";

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      gpsLabel.textContent = `GPS accuracy: ±${Math.round(accuracy)}m`;

      // Move map marker smoothly
      if (!riderMarker) {
        riderMarker = L.marker([lat, lng], { icon: buildRiderIcon() }).addTo(map);
        map.setView([lat, lng], 16);
      } else {
        riderMarker.setLatLng([lat, lng]);
        map.panTo([lat, lng], { animate: true, duration: 0.8 });
      }

      // Throttle Firestore writes
      const now = Date.now();
      if (now - lastWriteTime >= WRITE_INTERVAL_MS) {
        writeLocation(lat, lng);
        lastWriteTime = now;
      }
    },
    err => {
      console.warn("GPS error:", err);
      gpsLabel.textContent = "GPS unavailable — check permissions";
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

function stopGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  gpsLabel.textContent = "Location sharing ended";
}

// ── Load delivery data ────────────────────────────────────────────────────────
async function loadDelivery() {
  pillCode.textContent = code;

  const snap = await getDoc(deliveryRef);
  if (!snap.exists()) {
    showToast("⚠️ Delivery not found. Returning…", 3000);
    setTimeout(() => { window.location.replace("dashboard.html"); }, 3000);
    return;
  }

  const data = snap.data();
  infoPkg.textContent  = data.packageNote || "Not specified";
  infoBuyer.textContent= data.buyerName   || "Not specified";

  buyerLocation = data.buyerLocation || null;
  if (data.buyerAddress) {
    infoAddr.textContent = [data.buyerAddress.street, data.buyerAddress.city, data.buyerAddress.state]
      .filter(Boolean).join(", ");
  } else {
    infoAddr.textContent = "No address provided";
  }

  // Show destination on map if available
  if (buyerLocation) {
    destMarker = L.marker([buyerLocation.lat, buyerLocation.lng], { icon: buildDestIcon() })
      .addTo(map)
      .bindPopup("<b style='font-family:sans-serif'>Delivery Destination</b>");
    map.setView([buyerLocation.lat, buyerLocation.lng], 14);
  }

  // Restore stage from current Firestore status
  const status = data.status;
  if (status === "pending") {
    configureButton("idle");
  } else if (status === "accepted") {
    configureButton("collected");
  } else if (status === "in_transit" && !data.hasArrived) {
    configureButton("in_transit");
    startGPS();
  } else if (status === "in_transit" && data.hasArrived) {
    configureButton("arrived");
    startGPS();
  } else if (status === "delivered" && data.trackingActive) {
    configureButton("delivered");
    startGPS();
  } else {
    configureButton("ended");
  }
}

// ── Auth guard + init ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) { window.location.replace("index.html"); return; }
  loadDelivery();
});

// ── Real-time sync: if seller cancels or something changes ────────────────────
onSnapshot(deliveryRef, snap => {
  if (!snap.exists()) return;
  const d = snap.data();
  // If tracking was remotely ended
  if (d.trackingActive === false && currentStage !== "ended" && currentStage !== "idle") {
    configureButton("ended");
  }
});
