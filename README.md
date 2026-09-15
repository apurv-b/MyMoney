# MyMoney — Expense & Lending Ledger

A personal finance web app that combines an **expense/income tracker** with a **money-lending ledger**, built for people who track their spending *and* lend money to friends or family often.

No sign-up, no server, no backend — your data lives in your own browser.

---

## What it does

- Tracks day-to-day **expenses** and **income**, categorised and searchable.
- Tracks **money you've lent** to people, including partial repayments and automatic overdue detection.
- Shows a **dashboard** with your live balance, totals, and four charts.
- Groups loans **by person**, so you can see at a glance who owes you what.
- Keeps a unified **transaction history** across all four record types.
- Works fully **offline**, using your browser's `localStorage` — refresh or close the tab and your data is still there.
- Lets you **export/import a JSON backup**, and wipe all data if you want a clean start.

---

## Features

### Dashboard
- Current balance, total income, total expenses
- Total money lent, total received back, total currently owed to you
- Number of pending/overdue debts
- Charts: monthly expenses, expenses by category, lent vs. recovered, income vs. expenses
- Recent activity feed

### Expense tracker
- Add / edit / delete expenses (amount, category, date, payment method, notes)
- Search, filter by category, filter by month, sort newest/oldest
- Category-wise spending summary

### Income tracker
- Add / edit / delete income (amount, source, date, notes)
- Balance updates automatically

### Money lending / debt tracker
- Record a loan: person, amount, date lent, expected repayment date, reason, payment method, notes
- Record **multiple partial repayments** per loan, each with its own date, method, and notes
- Status is **always calculated automatically** from the numbers — never manually set:
  - 🟢 **Paid** — fully repaid
  - 🟡 **Partially Paid** — some of it repaid, not overdue
  - 🔴 **Pending** — nothing repaid yet, not overdue
  - ⚠️ **Overdue** — due date has passed and money is still owed
- **People view**: every person you've lent to, with totals, grouped across all their loans. Click a person to see their full loan history and repayment log.

### Data & backups
- All data is validated before saving (no negative or non-numeric amounts)
- Export everything as a single JSON file
- Import a JSON backup (replaces current data)
- Clear all data, with a confirmation step

### Design
- Light and dark mode, toggled from the sidebar
- Responsive: sidebar navigation on desktop, bottom tab bar on mobile
- No frameworks — just HTML, CSS and vanilla JavaScript

---

## Technologies used

| Piece | Choice | Why |
|---|---|---|
| Structure | Plain HTML5 | No build step needed |
| Styling | Plain CSS with custom properties | Powers the light/dark theme switch |
| Logic | Vanilla JavaScript (ES6+) | No framework overhead for a project this size |
| Storage | `localStorage` (Version 1) | Zero setup, works offline, easy to swap later |
| Charts | [Chart.js](https://www.chartjs.org/) (via CDN) | The one small library used, only for the four dashboard charts |
| Fonts | Google Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono | Loaded via CDN link tags |

---

## How to run it

You don't need Node, npm, or a build step.

1. Download or clone this repository.
2. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).

That's it — the app runs entirely client-side.

**Optional — running a local server** (some browsers restrict certain features when opening files directly with `file://`):

```bash
# Python 3
python -m http.server 8000
# then open http://localhost:8000
```

### Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under "Build and deployment", choose **Deploy from a branch**, pick `main` and the `/ (root)` folder.
4. Save — GitHub gives you a live URL within a minute or two.

---

## How localStorage works (and why it's used here)

`localStorage` is a small key-value storage area that every browser gives each website. Unlike variables in JavaScript, anything saved to `localStorage` **survives a page refresh and even closing the browser**, because it's written to disk, not just kept in memory.

In this app:

- All your data (`expenses`, `income`, `debts`, `settings`) lives in one JavaScript object called `appData`.
- `saveData()` converts that object to a JSON string with `JSON.stringify()` and writes it under one key, `mymoney_data_v1`.
- `loadData()` does the reverse on startup: reads the string back and parses it with `JSON.parse()`.
- Every add/edit/delete function updates `appData` in memory, then immediately calls `saveData()` — so nothing is ever "unsaved."

Two things worth knowing as a beginner:

- `localStorage` only stores **strings**, which is why objects/arrays have to be converted to JSON text and back.
- It's **per-browser, per-device**. Clearing your browser's site data, or opening the app in a different browser, starts you with an empty ledger — that's what the Export/Import backup feature is for.

---

## Project structure

```
mymoney/
├── index.html      # Page structure: dashboard, all views, and all modal forms
├── style.css       # All styling, including the light/dark theme variables
├── script.js       # All application logic (storage, calculations, CRUD, rendering)
├── README.md
└── assets/         # (empty — reserved for icons/images if you add any)
```

---

## Code structure (script.js)

The whole app is one file, but it's organised into clearly separated, single-purpose functions rather than one giant script — this is the map:

1. **Constants & state** — the `appData` object is the single source of truth.
2. **Storage layer** — `loadData()`, `saveData()`.
3. **Utility helpers** — `formatCurrency()`, `formatDate()`, `generateId()`, `showToast()`.
4. **Calculations** — `calculateBalance()`, `calculateRemainingDebt()`, `getDebtStatus()`, etc.
5. **CRUD operations** — `addExpense()`, `addIncome()`, `addDebt()`, `addRepayment()`, and their `update`/`delete` counterparts.
6. **Rendering** — `renderDashboard()`, `renderExpenses()`, `renderPeople()`, `renderTransactions()`, `renderCharts()`.
7. **Navigation** — `switchView()`.
8. **Modals & forms** — open/close helpers and one `handle*Submit()` function per form.
9. **Export / import / clear** — `exportData()`, `importData()`, `clearAllData()`.
10. **App start-up** — `init()`, which runs once on `DOMContentLoaded` and wires up every event listener.

If you're learning from this project, `init()` at the very bottom of `script.js` is the best place to start reading — everything else is called from there, directly or indirectly.

---

## Future improvements

- **Move to a real backend** (Firebase or Supabase) so data syncs across devices instead of living in one browser. The `loadData()`/`saveData()` functions are intentionally the *only* place that touch storage — swapping them for API calls is the main change needed.
- **Multi-user support** with accounts, once there's a backend.
- **Recurring transactions** (e.g. monthly salary, rent) that auto-add themselves.
- **Notifications/reminders** for upcoming or overdue due dates.
- **Budgets** per category, with progress bars and alerts when close to the limit.
- **CSV export**, alongside the existing JSON export, for opening in Excel/Sheets.
- **PWA support** (installable, offline-first with a service worker).
- **Currency settings**, for anyone who wants to use the app outside India.

---

## License

Free to use, modify, and learn from.
