// script.js - Dynamic Employee & Anomaly Dashboard Logic

let employees = [];
let timeOffset = 0; // in minutes
const DEFAULT_COMPANY = "Acme Corp"; // simulated company for Company Admin

// Elements
const simulatedTimeEl = document.getElementById("simulatedTime");
const roleSelect = document.getElementById("roleSelect");
const companyFilter = document.getElementById("companyFilter");
const companyFilterLabel = document.getElementById("companyFilterLabel");
const offsetInput = document.getElementById("offsetInput");
const applyOffsetBtn = document.getElementById("applyOffsetBtn");
const tableBody = document.getElementById("employeeTableBody");
const noDataEl = document.getElementById("noData");
const resetBtn = document.getElementById("resetBtn");

// Modal Elements
const editHoursModal = document.getElementById("editHoursModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalEmployeeName = document.getElementById("modalEmployeeName");
const allowedStartInput = document.getElementById("allowedStartInput");
const allowedEndInput = document.getElementById("allowedEndInput");
const saveHoursBtn = document.getElementById("saveHoursBtn");
const cancelHoursBtn = document.getElementById("cancelHoursBtn");
let activeEditId = null;

// Get simulated current time
function getSimulatedTime() {
  const now = new Date();
  const simulated = new Date(now.getTime() + timeOffset * 60 * 1000);
  return simulated;
}

// Format Date as HH:MM:SS
function formatTime(date) {
  return date.toTimeString().split(' ')[0];
}

// Tick simulated system clock
function updateClock() {
  const sim = getSimulatedTime();
  simulatedTimeEl.textContent = formatTime(sim);
}
setInterval(updateClock, 1000);
updateClock();

// Load data
async function initData() {
  // Load offset
  const storedOffset = localStorage.getItem("timeOffset");
  if (storedOffset !== null) {
    timeOffset = parseInt(storedOffset, 10);
    offsetInput.value = timeOffset;
  }

  // Load employees
  const storedEmployees = localStorage.getItem("employees");
  if (storedEmployees) {
    employees = JSON.parse(storedEmployees);
    renderTable();
  } else {
    await fetchSeedData();
  }
}

async function fetchSeedData() {
  try {
    const res = await fetch("employees.json");
    if (!res.ok) throw new Error("Failed to load seed file");
    employees = await res.json();
    saveToStorage();
    renderTable();
  } catch (err) {
    console.error(err);
    // Fallback seed data
    employees = [
      { id: 1, name: "Arjun Mehta", company: "Acme Corp", status: "active", allowedStart: "08:00", allowedEnd: "17:00", riskScore: 0, session: null },
      { id: 2, name: "Priya Sharma", company: "Acme Corp", status: "active", allowedStart: "08:00", allowedEnd: "17:00", riskScore: 0, session: null },
      { id: 3, name: "Rohan Das", company: "Beta Tech", status: "active", allowedStart: "08:00", allowedEnd: "17:00", riskScore: 0, session: null }
    ];
    saveToStorage();
    renderTable();
  }
}

function saveToStorage() {
  localStorage.setItem("employees", JSON.stringify(employees));
}

// Check if a given HH:MM time falls within allowed start & end hours
function isTimeInWindow(timeStr, startStr, endStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);

  const currentMinutes = h * 60 + m;
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Overlap midnight (e.g. 22:00 to 06:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

// Handle role UI restrictions
function handleRoleViewChanges() {
  const role = roleSelect.value;
  if (role === "superadmin") {
    companyFilter.disabled = false;
    companyFilter.style.display = "inline-block";
    companyFilterLabel.style.display = "inline-block";
  } else if (role === "companyadmin") {
    // Restricted to Acme Corp
    companyFilter.value = DEFAULT_COMPANY;
    companyFilter.disabled = true;
    companyFilter.style.display = "none";
    companyFilterLabel.style.display = "none";
  } else {
    // Normal admin - read only actions mostly
    companyFilter.disabled = false;
    companyFilter.style.display = "inline-block";
    companyFilterLabel.style.display = "inline-block";
  }
  renderTable();
}

// Render dynamic table rows
function renderTable() {
  const role = roleSelect.value;
  const company = companyFilter.value;

  // Filter based on role & company selection
  let filtered = employees;
  if (role === "companyadmin") {
    filtered = employees.filter(e => e.company === DEFAULT_COMPANY);
  } else {
    if (company !== "all") {
      filtered = employees.filter(e => e.company === company);
    }
  }

  tableBody.innerHTML = "";
  if (filtered.length === 0) {
    noDataEl.classList.remove("hidden");
    return;
  } else {
    noDataEl.classList.add("hidden");
  }

  filtered.forEach(emp => {
    const tr = document.createElement("tr");

    // Status Badge
    const statusBadge = emp.status === "locked"
      ? `<span class="badge badge-locked">Locked</span>`
      : `<span class="badge badge-active">Active</span>`;

    // Session status
    let sessionText = `<span class="text-muted">No active session</span>`;
    if (emp.session) {
      const anomalyFlag = emp.session.isAnomalous 
        ? ` <span class="badge badge-locked" style="font-size: 0.7rem; padding: 0.1rem 0.4rem; animation: pulse 1.5s infinite;">⚠️ ANOMALY</span>`
        : "";
      sessionText = `Active since ${emp.session.loginTime}${anomalyFlag}<br><small class="text-muted">IP: ${emp.session.ip}</small>`;
    }

    // Risk indicator
    let riskClass = "risk-low";
    if (emp.riskScore >= 70) riskClass = "risk-high";
    else if (emp.riskScore >= 30) riskClass = "risk-med";
    const riskBadge = `<span class="risk-badge ${riskClass}">${emp.riskScore}%</span>`;

    // Actions block based on Role
    let actionButtons = "";
    if (role === "superadmin" || role === "companyadmin") {
      // Toggle Lock Button
      const lockLabel = emp.status === "locked" ? "Unlock" : "Lock";
      const lockClass = emp.status === "locked" ? "btn-secondary" : "btn-danger";
      
      actionButtons += `
        <button class="${lockClass}" onclick="toggleLock(${emp.id})">${lockLabel}</button>
        <button class="btn-secondary" onclick="openEditModal(${emp.id})">Edit Hours</button>
      `;
    }

    // Login simulation button (always available to demo login anomaly checking)
    if (emp.status === "locked") {
      actionButtons += ` <button class="btn-secondary" disabled>Login Locked</button>`;
    } else if (emp.session) {
      actionButtons += ` <button class="btn-primary" onclick="simLogout(${emp.id})">Logout</button>`;
    } else {
      actionButtons += ` <button class="btn-primary" onclick="simLogin(${emp.id})">Simulate Login</button>`;
    }

    tr.innerHTML = `
      <td>
        <strong style="color: #fff;">${emp.name}</strong><br>
        <small class="text-muted">ID: ${emp.id}</small>
      </td>
      <td>${emp.company}</td>
      <td>${emp.allowedStart} - ${emp.allowedEnd}</td>
      <td>${statusBadge}</td>
      <td>${sessionText}</td>
      <td>${riskBadge}</td>
      <td>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          ${actionButtons}
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

// Simulate login & trigger anomalous checks
window.simLogin = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  if (emp.status === "locked") {
    alert(`❌ Cannot Login: ${emp.name}'s account is locked!`);
    return;
  }

  const simTime = getSimulatedTime();
  const timeStr = simTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

  const allowed = isTimeInWindow(timeStr, emp.allowedStart, emp.allowedEnd);

  let sessionData = {
    loginTime: formatTime(simTime),
    ip: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
    isAnomalous: !allowed
  };

  if (!allowed) {
    emp.riskScore = Math.min(100, emp.riskScore + 45); // increase risk score
    sessionData.isAnomalous = true;
    alert(`⚠️ Security Anomaly Detected!\n\nEmployee: ${emp.name}\nAttempted Login: ${timeStr} IST\nAllowed Access Hours: ${emp.allowedStart} to ${emp.allowedEnd} IST\n\nAccess permitted, but session has been FLAGGED and risk score bumped!`);
  } else {
    emp.riskScore = Math.max(0, emp.riskScore - 10); // slightly reduce on clean login
  }

  emp.session = sessionData;
  saveToStorage();
  renderTable();
};

// Simulate logout
window.simLogout = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  emp.session = null;
  saveToStorage();
  renderTable();
};

// Toggle employee lock status
window.toggleLock = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  if (emp.status === "locked") {
    emp.status = "active";
    emp.riskScore = Math.max(0, emp.riskScore - 20); // reduce risk on unlock
  } else {
    emp.status = "locked";
    emp.session = null; // terminate active session upon locking
    emp.riskScore = Math.min(100, emp.riskScore + 30);
  }

  saveToStorage();
  renderTable();
};

// Open allowed hours modal
window.openEditModal = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  activeEditId = id;
  modalEmployeeName.textContent = `${emp.name} (${emp.company})`;
  allowedStartInput.value = emp.allowedStart;
  allowedEndInput.value = emp.allowedEnd;

  editHoursModal.classList.remove("hidden");
};

// Close modal helper
function closeModal() {
  editHoursModal.classList.add("hidden");
  activeEditId = null;
}

// Modal event listeners
closeModalBtn.addEventListener("click", closeModal);
cancelHoursBtn.addEventListener("click", closeModal);

saveHoursBtn.addEventListener("click", () => {
  if (activeEditId === null) return;
  const emp = employees.find(e => e.id === activeEditId);
  if (emp) {
    emp.allowedStart = allowedStartInput.value;
    emp.allowedEnd = allowedEndInput.value;
    saveToStorage();
    renderTable();
    closeModal();
  }
});

// Apply offset controls
applyOffsetBtn.addEventListener("click", () => {
  const offset = parseInt(offsetInput.value, 10);
  if (isNaN(offset)) return;
  timeOffset = offset;
  localStorage.setItem("timeOffset", timeOffset);
  updateClock();
  alert(`🕒 System time offset set to ${timeOffset} minutes.`);
});

// Filter event listeners
roleSelect.addEventListener("change", handleRoleViewChanges);
companyFilter.addEventListener("change", renderTable);

// Reset handler
resetBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to reset all employee hours and sessions to defaults?")) {
    localStorage.removeItem("employees");
    localStorage.removeItem("timeOffset");
    timeOffset = 0;
    offsetInput.value = 0;
    fetchSeedData();
  }
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
  initData();
  handleRoleViewChanges();
});
