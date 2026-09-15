/* =========================================================================
   MyMoney — script.js
   ---------------------------------------------------------------------
   This file is organised top to bottom in the order the app boots:

     1. Constants & in-memory state
     2. Storage layer         (loadData / saveData)
     3. Small utility helpers (formatting, ids, toasts...)
     4. Calculations           (balance, debt status, totals...)
     5. CRUD operations        (addExpense, addDebt, addRepayment...)
     6. Rendering              (renderDashboard, renderExpenses...)
     7. Navigation             (switching between views)
     8. Modals & forms         (open/close, submit handlers)
     9. Export / import / clear data
     10. App start-up (event listeners + first render)

   Every function has ONE job. If you're new to JS, the best place to
   start reading is section 10 at the bottom — it shows what runs first.
   ========================================================================= */


/* =========================== 1. CONSTANTS & STATE ======================= */

const STORAGE_KEY = "mymoney_data_v1";

// The single source of truth for the whole app. Loaded from localStorage
// on startup, and every add/edit/delete mutates this object then re-saves it.
let appData = {
  expenses: [],   // { id, amount, category, date, paymentMethod, description }
  income: [],     // { id, amount, source, date, notes }
  debts: [],      // { id, person, amount, dateLent, dueDate, reason, paymentMethod, notes, repayments: [] }
  settings: { theme: "light" },
};

// Chart.js instances, kept here so we can destroy + redraw them whenever
// the underlying data changes (Chart.js does not update in place well
// unless you keep a reference to the chart object).
let charts = { monthly: null, category: null, lentVsRecovered: null, incomeVsExpenses: null };

// Small piece of UI state: which confirm-dialog action is currently queued.
let pendingConfirmAction = null;


/* =========================== 2. STORAGE LAYER =========================== */

/**
 * Reads saved data from localStorage into `appData`.
 * If nothing is saved yet (first visit), keeps the empty defaults above.
 * Wrapped in try/catch because malformed localStorage content should never
 * crash the whole app.
 */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appData = {
        expenses: parsed.expenses || [],
        income: parsed.income || [],
        debts: parsed.debts || [],
        settings: parsed.settings || { theme: "light" },
      };
    }
  } catch (err) {
    console.error("Could not read saved data, starting fresh.", err);
  }
}

/**
 * Writes the current `appData` object to localStorage as JSON.
 * Every CRUD function below calls this immediately after changing appData,
 * so the page never loses data on refresh or on closing the browser.
 */
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (err) {
    console.error("Could not save data.", err);
    showToast("Could not save — your browser storage may be full.");
  }
}


/* =========================== 3. UTILITY HELPERS ========================= */

/** Formats a number as Indian Rupees, e.g. 184500 -> "₹1,84,500". */
function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Formats an ISO date string ("2026-09-16") as "16 Sep 2026". */
function formatDate(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d)) return isoDate;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Returns today's date as an ISO string, used to default date inputs. */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Generates a reasonably-unique id for new records. */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Escapes text before it's inserted into innerHTML, to avoid broken markup. */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/** Shows a small toast message at the bottom of the screen for 2.5s. */
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2500);
}

/**
 * Validates that a value is a positive number suitable for an amount field.
 * Returns true/false — callers show their own error message.
 */
function isValidAmount(value) {
  const n = Number(value);
  return !isNaN(n) && n > 0 && isFinite(n);
}


/* =========================== 4. CALCULATIONS ============================ */

function calculateTotalIncome() {
  return appData.income.reduce((sum, i) => sum + i.amount, 0);
}

function calculateTotalExpenses() {
  return appData.expenses.reduce((sum, e) => sum + e.amount, 0);
}

function calculateTotalLent() {
  return appData.debts.reduce((sum, d) => sum + d.amount, 0);
}

/** Total repaid across every loan (all repayments, on every debt). */
function calculateTotalReceived() {
  return appData.debts.reduce((sum, d) => sum + calculateRepaidForDebt(d), 0);
}

/** How much has been paid back on a single debt so far. */
function calculateRepaidForDebt(debt) {
  return debt.repayments.reduce((sum, r) => sum + r.amount, 0);
}

/** How much is still owed on a single debt. */
function calculateRemainingDebt(debt) {
  return Math.max(0, debt.amount - calculateRepaidForDebt(debt));
}

/** Total still owed to you, across every loan. */
function calculateTotalOwed() {
  return appData.debts.reduce((sum, d) => sum + calculateRemainingDebt(d), 0);
}

/**
 * Your cash balance: money that came in, minus money that went out.
 * Lending money reduces your cash on hand; getting repaid increases it,
 * exactly like an expense and an income would.
 */
function calculateBalance() {
  return calculateTotalIncome() - calculateTotalExpenses() - calculateTotalLent() + calculateTotalReceived();
}

/**
 * Works out a debt's status from its data — never trusts a manually-set
 * status, per the spec. Order matters: fully repaid wins even if overdue;
 * overdue only applies while something is still owed.
 */
function getDebtStatus(debt) {
  const remaining = calculateRemainingDebt(debt);
  if (remaining <= 0) return "paid";
  const isOverdue = debt.dueDate && debt.dueDate < todayISO();
  if (isOverdue) return "overdue";
  if (calculateRepaidForDebt(debt) > 0) return "partial";
  return "pending";
}

const STATUS_LABELS = { paid: "🟢 Paid", partial: "🟡 Partially Paid", pending: "🔴 Pending", overdue: "⚠️ Overdue" };

function countPendingDebts() {
  return appData.debts.filter((d) => {
    const s = getDebtStatus(d);
    return s === "pending" || s === "partial" || s === "overdue";
  }).length;
}


/* =========================== 5. CRUD OPERATIONS ========================= */

// ---- Expenses ----

function addExpense(expense) {
  appData.expenses.push({ id: generateId(), ...expense });
  saveData();
}

function updateExpense(id, updates) {
  const item = appData.expenses.find((e) => e.id === id);
  if (item) Object.assign(item, updates);
  saveData();
}

function deleteExpense(id) {
  appData.expenses = appData.expenses.filter((e) => e.id !== id);
  saveData();
}

// ---- Income ----

function addIncome(income) {
  appData.income.push({ id: generateId(), ...income });
  saveData();
}

function updateIncome(id, updates) {
  const item = appData.income.find((i) => i.id === id);
  if (item) Object.assign(item, updates);
  saveData();
}

function deleteIncome(id) {
  appData.income = appData.income.filter((i) => i.id !== id);
  saveData();
}

// ---- Debts (money lent) ----

function addDebt(debt) {
  appData.debts.push({ id: generateId(), repayments: [], ...debt });
  saveData();
}

function updateDebt(id, updates) {
  const item = appData.debts.find((d) => d.id === id);
  if (item) Object.assign(item, updates);
  saveData();
}

function deleteDebt(id) {
  appData.debts = appData.debts.filter((d) => d.id !== id);
  saveData();
}

// ---- Repayments (nested inside a debt) ----

function addRepayment(debtId, repayment) {
  const debt = appData.debts.find((d) => d.id === debtId);
  if (!debt) return;
  debt.repayments.push({ id: generateId(), ...repayment });
  saveData();
}

function deleteRepayment(debtId, repaymentId) {
  const debt = appData.debts.find((d) => d.id === debtId);
  if (!debt) return;
  debt.repayments = debt.repayments.filter((r) => r.id !== repaymentId);
  saveData();
}


/* =========================== 6. RENDERING ================================ */

/** Re-renders everything. Called after any data change and on startup. */
function renderAll() {
  renderDashboard();
  renderExpenses();
  renderIncome();
  renderPeople();
  renderTransactions();
}

function renderDashboard() {
  document.getElementById("statBalance").textContent = formatCurrency(calculateBalance());
  document.getElementById("statIncome").textContent = formatCurrency(calculateTotalIncome());
  document.getElementById("statExpenses").textContent = formatCurrency(calculateTotalExpenses());
  document.getElementById("statLent").textContent = formatCurrency(calculateTotalLent());
  document.getElementById("statReceived").textContent = formatCurrency(calculateTotalReceived());
  document.getElementById("statOwed").textContent = formatCurrency(calculateTotalOwed());
  document.getElementById("statPendingCount").textContent = countPendingDebts();

  renderRecentActivity();
  renderCharts();
}

/** Builds a flat, chronological list of every transaction across all data. */
function getAllTransactions() {
  const tx = [];
  appData.income.forEach((i) => tx.push({ type: "income", date: i.date, label: i.source, amount: i.amount, notes: i.notes }));
  appData.expenses.forEach((e) => tx.push({ type: "expense", date: e.date, label: e.category, amount: e.amount, notes: e.description }));
  appData.debts.forEach((d) => {
    tx.push({ type: "lent", date: d.dateLent, label: `Lent to ${d.person}`, amount: d.amount, notes: d.reason });
    d.repayments.forEach((r) => tx.push({ type: "repayment", date: r.date, label: `${d.person} repaid`, amount: r.amount, notes: r.notes }));
  });
  return tx.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function renderRecentActivity() {
  const list = document.getElementById("recentActivityList");
  const recent = getAllTransactions().slice(0, 8);
  list.innerHTML = recent.map(transactionRowHtml).join("") || `<p class="empty-state">No activity yet — add your first expense or income.</p>`;
}

const TX_TAG = { income: "tag-income", expense: "tag-expense", lent: "tag-lent", repayment: "tag-repayment" };
const TX_LABEL = { income: "Income", expense: "Expense", lent: "Lent", repayment: "Repaid" };
const TX_SIGN = { income: "plus", expense: "minus", lent: "minus", repayment: "plus" };

function transactionRowHtml(tx) {
  return `
    <li class="ledger-row">
      <span class="ledger-date">${formatDate(tx.date)}</span>
      <span class="ledger-desc">
        <span class="ledger-tag ${TX_TAG[tx.type]}">${TX_LABEL[tx.type]}</span>
        ${escapeHtml(tx.label)}${tx.notes ? " · " + escapeHtml(tx.notes) : ""}
      </span>
      <span class="ledger-amount ${TX_SIGN[tx.type]}">${formatCurrency(tx.amount)}</span>
    </li>`;
}

/** Draws / redraws the four dashboard charts using Chart.js. */
function renderCharts() {
  const isDark = document.body.classList.contains("dark");
  const gridColor = isDark ? "#2B3B57" : "#DBD9D0";
  const textColor = isDark ? "#ABB4C4" : "#4B5768";
  Chart.defaults.color = textColor;
  Chart.defaults.font.family = "IBM Plex Sans";

  // --- Monthly expenses (last 6 months) ---
  const months = lastNMonths(6);
  const monthlyTotals = months.map((m) =>
    appData.expenses.filter((e) => e.date.slice(0, 7) === m.key).reduce((s, e) => s + e.amount, 0)
  );
  renderOrUpdateChart("monthly", "chartMonthlyExpenses", {
    type: "bar",
    data: { labels: months.map((m) => m.label), datasets: [{ data: monthlyTotals, backgroundColor: "#A44432", borderRadius: 4 }] },
    options: baseChartOptions(gridColor, false),
  });

  // --- Expenses by category ---
  const categories = [...new Set(appData.expenses.map((e) => e.category))];
  const categoryTotals = categories.map((c) => appData.expenses.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0));
  renderOrUpdateChart("category", "chartCategory", {
    type: "doughnut",
    data: {
      labels: categories,
      datasets: [{ data: categoryTotals, backgroundColor: ["#B8862E", "#2F6B52", "#A44432", "#6C8CBF", "#8891A0", "#D9B15C", "#4B5768", "#7A5C3E"] }],
    },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10, font: { size: 11 } } } }, maintainAspectRatio: false },
  });

  // --- Lent vs recovered ---
  renderOrUpdateChart("lentVsRecovered", "chartLentVsRecovered", {
    type: "bar",
    data: {
      labels: ["Money lent", "Recovered"],
      datasets: [{ data: [calculateTotalLent(), calculateTotalReceived()], backgroundColor: ["#A44432", "#2F6B52"], borderRadius: 4 }],
    },
    options: baseChartOptions(gridColor, false),
  });

  // --- Income vs expenses ---
  renderOrUpdateChart("incomeVsExpenses", "chartIncomeVsExpenses", {
    type: "bar",
    data: {
      labels: ["Income", "Expenses"],
      datasets: [{ data: [calculateTotalIncome(), calculateTotalExpenses()], backgroundColor: ["#2F6B52", "#A44432"], borderRadius: 4 }],
    },
    options: baseChartOptions(gridColor, false),
  });
}

function baseChartOptions(gridColor) {
  return {
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: gridColor }, beginAtZero: true },
    },
  };
}

function renderOrUpdateChart(key, canvasId, config) {
  if (charts[key]) charts[key].destroy();
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[key] = new Chart(ctx, config);
}

/** Returns the last N months as { key: "2026-09", label: "Sep" } objects, oldest first. */
function lastNMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-IN", { month: "short" }) });
  }
  return out;
}

// ---- Expenses view ----

function getFilteredExpenses() {
  const search = document.getElementById("expenseSearch").value.trim().toLowerCase();
  const category = document.getElementById("expenseCategoryFilter").value;
  const month = document.getElementById("expenseMonthFilter").value;
  const sort = document.getElementById("expenseSort").value;

  let list = appData.expenses.filter((e) => {
    const matchesSearch = !search || e.description?.toLowerCase().includes(search) || e.category.toLowerCase().includes(search);
    const matchesCategory = !category || e.category === category;
    const matchesMonth = !month || e.date.slice(0, 7) === month;
    return matchesSearch && matchesCategory && matchesMonth;
  });

  list.sort((a, b) => (sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return list;
}

function renderExpenses() {
  const list = getFilteredExpenses();
  const tbody = document.getElementById("expenseTableBody");
  tbody.innerHTML = list
    .map(
      (e) => `
    <tr>
      <td>${formatDate(e.date)}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.description || "—")}</td>
      <td>${escapeHtml(e.paymentMethod)}</td>
      <td class="num">${formatCurrency(e.amount)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-expense="${e.id}" title="Edit">✎</button>
          <button class="icon-btn danger" data-delete-expense="${e.id}" title="Delete">🗑</button>
        </div>
      </td>
    </tr>`
    )
    .join("");
  document.getElementById("expenseEmptyState").hidden = list.length !== 0;

  // Category-wise spending summary chips
  const byCategory = {};
  appData.expenses.forEach((e) => (byCategory[e.category] = (byCategory[e.category] || 0) + e.amount));
  const summaryEl = document.getElementById("categorySummary");
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  summaryEl.innerHTML =
    entries.map(([cat, total]) => `<span class="category-chip">${escapeHtml(cat)} <strong>${formatCurrency(total)}</strong></span>`).join("") ||
    "";
}

// ---- Income view ----

function renderIncome() {
  const list = [...appData.income].sort((a, b) => b.date.localeCompare(a.date));
  const tbody = document.getElementById("incomeTableBody");
  tbody.innerHTML = list
    .map(
      (i) => `
    <tr>
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.source)}</td>
      <td>${escapeHtml(i.notes || "—")}</td>
      <td class="num">${formatCurrency(i.amount)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-income="${i.id}" title="Edit">✎</button>
          <button class="icon-btn danger" data-delete-income="${i.id}" title="Delete">🗑</button>
        </div>
      </td>
    </tr>`
    )
    .join("");
  document.getElementById("incomeEmptyState").hidden = list.length !== 0;
}

// ---- People / debts view ----

/** Groups all loans by person name and totals them up. */
function getPeopleSummary() {
  const byPerson = {};
  appData.debts.forEach((d) => {
    if (!byPerson[d.person]) byPerson[d.person] = { person: d.person, totalLent: 0, totalRepaid: 0, loans: [] };
    byPerson[d.person].totalLent += d.amount;
    byPerson[d.person].totalRepaid += calculateRepaidForDebt(d);
    byPerson[d.person].loans.push(d);
  });
  return Object.values(byPerson).sort((a, b) => a.person.localeCompare(b.person));
}

function renderPeople() {
  const people = getPeopleSummary();
  const grid = document.getElementById("peopleGrid");
  grid.innerHTML = people
    .map((p) => {
      const remaining = p.totalLent - p.totalRepaid;
      // A person's overall status: worst-case across their loans.
      const statuses = p.loans.map(getDebtStatus);
      const overall = statuses.includes("overdue") ? "overdue" : remaining <= 0 ? "paid" : statuses.includes("partial") ? "partial" : "pending";
      return `
      <div class="person-card" data-person="${escapeHtml(p.person)}">
        <div class="person-name">${escapeHtml(p.person)}</div>
        <div class="person-stat-row"><span>Total lent</span><span>${formatCurrency(p.totalLent)}</span></div>
        <div class="person-stat-row"><span>Paid back</span><span>${formatCurrency(p.totalRepaid)}</span></div>
        <div class="person-stat-row"><span>Remaining</span><span>${formatCurrency(remaining)}</span></div>
        <span class="status-pill status-${overall}">${STATUS_LABELS[overall]}</span>
      </div>`;
    })
    .join("");
  document.getElementById("peopleEmptyState").hidden = people.length !== 0;
}

let currentPersonView = null;

function renderPersonDetail(personName) {
  currentPersonView = personName;
  const loans = appData.debts.filter((d) => d.person === personName);
  const totalLent = loans.reduce((s, d) => s + d.amount, 0);
  const totalRepaid = loans.reduce((s, d) => s + calculateRepaidForDebt(d), 0);

  document.getElementById("personDetailName").textContent = personName;
  document.getElementById("personDetailSummary").textContent =
    `${formatCurrency(totalLent)} lent in total · ${formatCurrency(totalRepaid)} paid back · ${formatCurrency(totalLent - totalRepaid)} remaining`;

  const container = document.getElementById("personLoansList");
  container.innerHTML = loans
    .map((d) => {
      const repaid = calculateRepaidForDebt(d);
      const remaining = calculateRemainingDebt(d);
      const pct = d.amount > 0 ? Math.min(100, Math.round((repaid / d.amount) * 100)) : 0;
      const status = getDebtStatus(d);
      return `
      <div class="loan-card">
        <div class="loan-card-top">
          <div>
            <div class="loan-reason">${escapeHtml(d.reason || "Loan")}</div>
            <div class="loan-meta">Lent ${formatDate(d.dateLent)} via ${escapeHtml(d.paymentMethod)}${d.dueDate ? " · Due " + formatDate(d.dueDate) : ""}</div>
          </div>
          <span class="status-pill status-${status}">${STATUS_LABELS[status]}</span>
        </div>

        <div class="loan-amounts">
          <div class="loan-amount-block">Original<strong>${formatCurrency(d.amount)}</strong></div>
          <div class="loan-amount-block">Repaid<strong>${formatCurrency(repaid)}</strong></div>
          <div class="loan-amount-block">Remaining<strong>${formatCurrency(remaining)}</strong></div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>

        ${d.notes ? `<div class="loan-meta">${escapeHtml(d.notes)}</div>` : ""}

        <div class="loan-actions">
          ${remaining > 0 ? `<button class="btn-secondary" data-add-repayment="${d.id}">+ Record repayment</button>` : ""}
          <button class="btn-secondary" data-edit-debt="${d.id}">Edit loan</button>
          <button class="btn-danger" data-delete-debt="${d.id}">Delete loan</button>
        </div>

        ${
          d.repayments.length
            ? `<div class="repayment-history">
                <div class="repayment-history-title">Repayment history</div>
                ${d.repayments
                  .slice()
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map(
                    (r) => `
                  <div class="repayment-item">
                    <span><span class="r-date">${formatDate(r.date)}</span> · ${escapeHtml(r.paymentMethod)}${r.notes ? " · " + escapeHtml(r.notes) : ""}</span>
                    <span>
                      ${formatCurrency(r.amount)}
                      <button class="icon-btn danger" data-delete-repayment="${d.id}|${r.id}" title="Delete repayment">🗑</button>
                    </span>
                  </div>`
                  )
                  .join("")}
              </div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

// ---- Transactions view ----

function renderTransactions() {
  const search = document.getElementById("txSearch").value.trim().toLowerCase();
  const type = document.getElementById("txTypeFilter").value;
  const month = document.getElementById("txMonthFilter").value;

  let list = getAllTransactions().filter((tx) => {
    const matchesSearch = !search || tx.label.toLowerCase().includes(search) || (tx.notes || "").toLowerCase().includes(search);
    const matchesType = !type || tx.type === type;
    const matchesMonth = !month || tx.date.slice(0, 7) === month;
    return matchesSearch && matchesType && matchesMonth;
  });

  const listEl = document.getElementById("txList");
  listEl.innerHTML = list.map(transactionRowHtml).join("");
  document.getElementById("txEmptyState").hidden = list.length !== 0;
}


/* =========================== 7. NAVIGATION =============================== */

function switchView(viewName) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${viewName}`)?.classList.add("active");

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  // Charts only draw correctly once their canvas is visible, so redraw
  // when the dashboard becomes active again.
  if (viewName === "dashboard") renderCharts();
  window.scrollTo({ top: 0 });
}

function openPersonDetail(personName) {
  renderPersonDetail(personName);
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-person-detail").classList.add("active");
  window.scrollTo({ top: 0 });
}


/* =========================== 8. MODALS & FORMS ============================ */

function openModal(id) {
  document.getElementById(id).showModal();
}
function closeModal(id) {
  document.getElementById(id).close();
}

// ---- Expense form ----

function openAddExpenseModal() {
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseId").value = "";
  document.getElementById("expenseModalTitle").textContent = "Add expense";
  document.getElementById("expenseDate").value = todayISO();
  document.getElementById("expenseFormError").textContent = "";
  openModal("expenseModal");
}

function openEditExpenseModal(id) {
  const e = appData.expenses.find((x) => x.id === id);
  if (!e) return;
  document.getElementById("expenseId").value = e.id;
  document.getElementById("expenseModalTitle").textContent = "Edit expense";
  document.getElementById("expenseAmount").value = e.amount;
  document.getElementById("expenseCategory").value = e.category;
  document.getElementById("expenseDate").value = e.date;
  document.getElementById("expensePaymentMethod").value = e.paymentMethod;
  document.getElementById("expenseDescription").value = e.description || "";
  document.getElementById("expenseFormError").textContent = "";
  openModal("expenseModal");
}

function handleExpenseSubmit(evt) {
  evt.preventDefault();
  const amount = document.getElementById("expenseAmount").value;
  if (!isValidAmount(amount)) {
    document.getElementById("expenseFormError").textContent = "Enter an amount greater than 0.";
    return;
  }
  const payload = {
    amount: Number(amount),
    category: document.getElementById("expenseCategory").value,
    date: document.getElementById("expenseDate").value,
    paymentMethod: document.getElementById("expensePaymentMethod").value,
    description: document.getElementById("expenseDescription").value.trim(),
  };
  const id = document.getElementById("expenseId").value;
  if (id) {
    updateExpense(id, payload);
    showToast("Expense updated");
  } else {
    addExpense(payload);
    showToast("Expense added");
  }
  closeModal("expenseModal");
  renderAll();
}

// ---- Income form ----

function openAddIncomeModal() {
  document.getElementById("incomeForm").reset();
  document.getElementById("incomeId").value = "";
  document.getElementById("incomeModalTitle").textContent = "Add income";
  document.getElementById("incomeDate").value = todayISO();
  document.getElementById("incomeFormError").textContent = "";
  openModal("incomeModal");
}

function openEditIncomeModal(id) {
  const i = appData.income.find((x) => x.id === id);
  if (!i) return;
  document.getElementById("incomeId").value = i.id;
  document.getElementById("incomeModalTitle").textContent = "Edit income";
  document.getElementById("incomeAmount").value = i.amount;
  document.getElementById("incomeSource").value = i.source;
  document.getElementById("incomeDate").value = i.date;
  document.getElementById("incomeNotes").value = i.notes || "";
  document.getElementById("incomeFormError").textContent = "";
  openModal("incomeModal");
}

function handleIncomeSubmit(evt) {
  evt.preventDefault();
  const amount = document.getElementById("incomeAmount").value;
  if (!isValidAmount(amount)) {
    document.getElementById("incomeFormError").textContent = "Enter an amount greater than 0.";
    return;
  }
  const payload = {
    amount: Number(amount),
    source: document.getElementById("incomeSource").value,
    date: document.getElementById("incomeDate").value,
    notes: document.getElementById("incomeNotes").value.trim(),
  };
  const id = document.getElementById("incomeId").value;
  if (id) {
    updateIncome(id, payload);
    showToast("Income updated");
  } else {
    addIncome(payload);
    showToast("Income added");
  }
  closeModal("incomeModal");
  renderAll();
}

// ---- Debt (money lent) form ----

function openAddDebtModal() {
  document.getElementById("debtForm").reset();
  document.getElementById("debtId").value = "";
  document.getElementById("debtModalTitle").textContent = "Record money lent";
  document.getElementById("debtDateLent").value = todayISO();
  document.getElementById("debtFormError").textContent = "";
  openModal("debtModal");
}

function openEditDebtModal(id) {
  const d = appData.debts.find((x) => x.id === id);
  if (!d) return;
  document.getElementById("debtId").value = d.id;
  document.getElementById("debtModalTitle").textContent = "Edit loan";
  document.getElementById("debtPerson").value = d.person;
  document.getElementById("debtAmount").value = d.amount;
  document.getElementById("debtDateLent").value = d.dateLent;
  document.getElementById("debtDueDate").value = d.dueDate || "";
  document.getElementById("debtReason").value = d.reason || "";
  document.getElementById("debtPaymentMethod").value = d.paymentMethod;
  document.getElementById("debtNotes").value = d.notes || "";
  document.getElementById("debtFormError").textContent = "";
  openModal("debtModal");
}

function handleDebtSubmit(evt) {
  evt.preventDefault();
  const amount = document.getElementById("debtAmount").value;
  const person = document.getElementById("debtPerson").value.trim();
  if (!person) {
    document.getElementById("debtFormError").textContent = "Enter the person's name.";
    return;
  }
  if (!isValidAmount(amount)) {
    document.getElementById("debtFormError").textContent = "Enter an amount greater than 0.";
    return;
  }
  const payload = {
    person,
    amount: Number(amount),
    dateLent: document.getElementById("debtDateLent").value,
    dueDate: document.getElementById("debtDueDate").value,
    reason: document.getElementById("debtReason").value.trim(),
    paymentMethod: document.getElementById("debtPaymentMethod").value,
    notes: document.getElementById("debtNotes").value.trim(),
  };
  const id = document.getElementById("debtId").value;
  if (id) {
    updateDebt(id, payload);
    showToast("Loan updated");
  } else {
    addDebt(payload);
    showToast("Loan recorded");
  }
  closeModal("debtModal");
  renderAll();
  if (currentPersonView) renderPersonDetail(currentPersonView);
}

// ---- Repayment form ----

function openAddRepaymentModal(debtId) {
  const d = appData.debts.find((x) => x.id === debtId);
  if (!d) return;
  document.getElementById("repaymentForm").reset();
  document.getElementById("repaymentDebtId").value = debtId;
  document.getElementById("repaymentDate").value = todayISO();
  document.getElementById("repaymentContext").textContent =
    `${d.person} — ${formatCurrency(calculateRemainingDebt(d))} still remaining of ${formatCurrency(d.amount)}.`;
  document.getElementById("repaymentFormError").textContent = "";
  openModal("repaymentModal");
}

function handleRepaymentSubmit(evt) {
  evt.preventDefault();
  const debtId = document.getElementById("repaymentDebtId").value;
  const amount = document.getElementById("repaymentAmount").value;
  const debt = appData.debts.find((d) => d.id === debtId);
  if (!isValidAmount(amount)) {
    document.getElementById("repaymentFormError").textContent = "Enter an amount greater than 0.";
    return;
  }
  const remaining = calculateRemainingDebt(debt);
  if (Number(amount) > remaining + 0.001) {
    document.getElementById("repaymentFormError").textContent = `That's more than the ${formatCurrency(remaining)} still owed.`;
    return;
  }
  addRepayment(debtId, {
    amount: Number(amount),
    date: document.getElementById("repaymentDate").value,
    paymentMethod: document.getElementById("repaymentPaymentMethod").value,
    notes: document.getElementById("repaymentNotes").value.trim(),
  });
  showToast("Repayment recorded");
  closeModal("repaymentModal");
  renderAll();
  if (currentPersonView) renderPersonDetail(currentPersonView);
}

// ---- Generic confirm dialog (used for every delete + clear-all) ----

function openConfirm(title, message, onConfirm) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  pendingConfirmAction = onConfirm;
  openModal("confirmModal");
}


/* =========================== 9. EXPORT / IMPORT / CLEAR =================== */

function exportData() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mymoney-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Backup downloaded");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid file");
      appData = {
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
        income: Array.isArray(parsed.income) ? parsed.income : [],
        debts: Array.isArray(parsed.debts) ? parsed.debts : [],
        settings: parsed.settings || appData.settings,
      };
      saveData();
      renderAll();
      showToast("Data imported successfully");
    } catch (err) {
      console.error(err);
      showToast("That file couldn't be read — is it a MyMoney export?");
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  appData = { expenses: [], income: [], debts: [], settings: appData.settings };
  saveData();
  renderAll();
  showToast("All data cleared");
}


/* =========================== 10. APP START-UP ============================= */

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  document.getElementById("themeLabel").textContent = theme === "dark" ? "Light mode" : "Dark mode";
  document.getElementById("themeIcon").textContent = theme === "dark" ? "☀" : "◐";
}

function toggleTheme() {
  const next = document.body.classList.contains("dark") ? "light" : "dark";
  appData.settings.theme = next;
  saveData();
  applyTheme(next);
  renderCharts(); // chart colors depend on theme
}

function attachEventListeners() {
  // Sidebar + mobile nav
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.getElementById("backToPeople").addEventListener("click", () => switchView("people"));
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  // Add buttons
  document.getElementById("openAddExpense").addEventListener("click", openAddExpenseModal);
  document.getElementById("openAddIncome").addEventListener("click", openAddIncomeModal);
  document.getElementById("openAddDebt").addEventListener("click", openAddDebtModal);

  // Forms
  document.getElementById("expenseForm").addEventListener("submit", handleExpenseSubmit);
  document.getElementById("incomeForm").addEventListener("submit", handleIncomeSubmit);
  document.getElementById("debtForm").addEventListener("submit", handleDebtSubmit);
  document.getElementById("repaymentForm").addEventListener("submit", handleRepaymentSubmit);

  // Modal close buttons (shared across every modal via data-close)
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  // Confirm dialog action button
  document.getElementById("confirmActionBtn").addEventListener("click", () => {
    if (pendingConfirmAction) pendingConfirmAction();
    pendingConfirmAction = null;
    closeModal("confirmModal");
  });

  // Filters (expenses)
  ["expenseSearch", "expenseCategoryFilter", "expenseMonthFilter", "expenseSort"].forEach((id) =>
    document.getElementById(id).addEventListener("input", renderExpenses)
  );
  // Filters (transactions)
  ["txSearch", "txTypeFilter", "txMonthFilter"].forEach((id) => document.getElementById(id).addEventListener("input", renderTransactions));

  // Event delegation for dynamically-rendered rows/cards (edit/delete/repay buttons)
  document.addEventListener("click", (evt) => {
    const t = evt.target;

    if (t.dataset.editExpense) openEditExpenseModal(t.dataset.editExpense);
    if (t.dataset.deleteExpense) {
      openConfirm("Delete this expense?", "This can't be undone.", () => {
        deleteExpense(t.dataset.deleteExpense);
        renderAll();
        showToast("Expense deleted");
      });
    }

    if (t.dataset.editIncome) openEditIncomeModal(t.dataset.editIncome);
    if (t.dataset.deleteIncome) {
      openConfirm("Delete this income entry?", "This can't be undone.", () => {
        deleteIncome(t.dataset.deleteIncome);
        renderAll();
        showToast("Income deleted");
      });
    }

    if (t.dataset.editDebt) openEditDebtModal(t.dataset.editDebt);
    if (t.dataset.deleteDebt) {
      openConfirm("Delete this loan?", "Its repayment history will be deleted too. This can't be undone.", () => {
        deleteDebt(t.dataset.deleteDebt);
        renderAll();
        if (currentPersonView) renderPersonDetail(currentPersonView);
        showToast("Loan deleted");
      });
    }
    if (t.dataset.addRepayment) openAddRepaymentModal(t.dataset.addRepayment);
    if (t.dataset.deleteRepayment) {
      const [debtId, repaymentId] = t.dataset.deleteRepayment.split("|");
      openConfirm("Delete this repayment?", "This can't be undone.", () => {
        deleteRepayment(debtId, repaymentId);
        renderAll();
        if (currentPersonView) renderPersonDetail(currentPersonView);
        showToast("Repayment deleted");
      });
    }

    // Clicking a person card opens their detail view
    const personCard = t.closest(".person-card");
    if (personCard) openPersonDetail(personCard.dataset.person);
  });

  // Settings: export / import / clear
  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("importInput").addEventListener("change", (evt) => {
    const file = evt.target.files[0];
    if (file) importData(file);
    evt.target.value = "";
  });
  document.getElementById("clearDataBtn").addEventListener("click", () => {
    openConfirm("Clear all data?", "Every expense, income entry, and loan will be permanently deleted.", clearAllData);
  });
}

function init() {
  loadData();
  applyTheme(appData.settings.theme || "light");
  attachEventListeners();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
