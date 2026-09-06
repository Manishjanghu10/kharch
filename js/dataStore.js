/* All persistence for Kharch, fully client-side (IndexedDB + localStorage
   for the session flag). This is the ONLY file that talks to storage --
   every page calls DataStore.* functions, never IndexedDB directly. If
   this ever moves to a real backend, only this file needs to change (swap
   the bodies below for fetch() calls); index.html/login.html/signup.html
   and their scripts should not need to change at all. */

const DB_NAME = "kharch_db";
const DB_VERSION = 2;
const SESSION_KEY = "kharch_session_email";
const LAST_EMAIL_KEY = "kharch_last_email";
const TOTAL_BUDGET_CATEGORY = "__TOTAL__";

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "email" });
      }
      if (!db.objectStoreNames.contains("expenses")) {
        const store = db.createObjectStore("expenses", { keyPath: "id", autoIncrement: true });
        store.createIndex("byUserDate", ["userEmail", "spentDate"]);
        store.createIndex("byUser", "userEmail");
      }
      if (!db.objectStoreNames.contains("budgets")) {
        const store = db.createObjectStore("budgets", { keyPath: "id" });
        store.createIndex("byUser", "userEmail");
      }
      if (!db.objectStoreNames.contains("categoryMemory")) {
        const store = db.createObjectStore("categoryMemory", { keyPath: "id" });
        store.createIndex("byUser", "userEmail");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+\-\s]{7,15}$/;

// Unambiguous alphabet (no 0/O/1/I/l) for recovery keys shown to a human.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let chars = "";
  for (const b of bytes) chars += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return chars.match(/.{1,4}/g).join("-"); // e.g. ABCD-EFGH-JKMN-PQRS
}

function normalizeRecoveryCode(code) {
  return (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- auth ----------

async function signup({ name, email, phone, password }) {
  name = (name || "").trim();
  email = (email || "").trim().toLowerCase();
  phone = (phone || "").trim();
  if (!name) return { ok: false, error: "Name can't be empty." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!PHONE_RE.test(phone)) return { ok: false, error: "Enter a valid phone number." };
  if (!password || password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const db = await openDb();
  const existing = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  if (existing) return { ok: false, error: "An account with this email already exists on this device." };

  const { saltB64, hashB64 } = await Crypto.hashPassword(password);
  const recoveryCode = generateRecoveryCode();
  const recovery = await Crypto.hashPassword(normalizeRecoveryCode(recoveryCode));
  const user = {
    email, name, phone, saltB64, hashB64,
    recoverySaltB64: recovery.saltB64, recoveryHashB64: recovery.hashB64,
    pinSaltB64: null, pinHashB64: null,
    webauthnCredentialId: null,
    createdAt: new Date().toISOString(),
  };
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").add(user));
  localStorage.setItem(SESSION_KEY, email);
  localStorage.setItem(LAST_EMAIL_KEY, email);
  return { ok: true, recoveryCode };
}

async function resetPassword({ email, recoveryCode, newPassword }) {
  email = (email || "").trim().toLowerCase();
  const code = normalizeRecoveryCode(recoveryCode);
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  const db = await openDb();
  // Read-only lookup first; IndexedDB transactions auto-close across the
  // await Crypto.* calls below (they're not IDB operations), so the write
  // further down deliberately opens a brand-new transaction of its own
  // rather than reusing this one.
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  const badKey = { ok: false, error: "No account with that email and recovery key was found on this device." };
  if (!user || !user.recoverySaltB64 || !user.recoveryHashB64) return badKey;

  const valid = await Crypto.verifyPassword(code, user.recoverySaltB64, user.recoveryHashB64);
  if (!valid) return badKey;

  const { saltB64, hashB64 } = await Crypto.hashPassword(newPassword);
  const newRecoveryCode = generateRecoveryCode(); // recovery keys are single-use
  const newRecovery = await Crypto.hashPassword(normalizeRecoveryCode(newRecoveryCode));
  user.saltB64 = saltB64;
  user.hashB64 = hashB64;
  user.recoverySaltB64 = newRecovery.saltB64;
  user.recoveryHashB64 = newRecovery.hashB64;
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").put(user));
  localStorage.setItem(SESSION_KEY, email);
  localStorage.setItem(LAST_EMAIL_KEY, email);
  return { ok: true, recoveryCode: newRecoveryCode };
}

async function login({ email, password }) {
  email = (email || "").trim().toLowerCase();
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  if (!user) return { ok: false, error: "Incorrect email or password." };
  const valid = await Crypto.verifyPassword(password, user.saltB64, user.hashB64);
  if (!valid) return { ok: false, error: "Incorrect email or password." };
  localStorage.setItem(SESSION_KEY, email);
  localStorage.setItem(LAST_EMAIL_KEY, email);
  return { ok: true };
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
}

function sessionEmail() {
  return localStorage.getItem(SESSION_KEY);
}

async function currentUser() {
  const email = sessionEmail();
  if (!email) return null;
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  if (!user) { logout(); return null; }
  return { email: user.email, name: user.name, phone: user.phone };
}

function requireEmail() {
  const email = sessionEmail();
  if (!email) throw new Error("Not logged in.");
  return email;
}

// ---------- quick unlock: PIN + biometric ----------

function lastEmail() {
  return localStorage.getItem(LAST_EMAIL_KEY);
}

async function quickUnlockInfo(email) {
  email = (email || "").trim().toLowerCase();
  if (!email) return null;
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  if (!user) return null;
  return {
    email: user.email, name: user.name,
    hasPin: !!(user.pinSaltB64 && user.pinHashB64),
    hasWebauthn: !!user.webauthnCredentialId,
    webauthnCredentialId: user.webauthnCredentialId,
  };
}

async function setPin(pin) {
  const email = requireEmail();
  if (!/^\d{4}$/.test(pin || "")) return { ok: false, error: "PIN must be 4 digits." };
  const db = await openDb();
  const store = tx(db, "users", "readwrite").objectStore("users");
  const user = await reqToPromise(store.get(email));
  const { saltB64, hashB64 } = await Crypto.hashPassword(pin);
  user.pinSaltB64 = saltB64;
  user.pinHashB64 = hashB64;
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").put(user));
  return { ok: true };
}

async function clearPin() {
  const email = requireEmail();
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  user.pinSaltB64 = null;
  user.pinHashB64 = null;
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").put(user));
  return { ok: true };
}

async function quickUnlockWithPin({ email, pin }) {
  email = (email || "").trim().toLowerCase();
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  if (!user || !user.pinSaltB64 || !user.pinHashB64) return { ok: false, error: "No PIN set for this account." };
  const valid = await Crypto.verifyPassword(pin, user.pinSaltB64, user.pinHashB64);
  if (!valid) return { ok: false, error: "Incorrect PIN." };
  localStorage.setItem(SESSION_KEY, email);
  localStorage.setItem(LAST_EMAIL_KEY, email);
  return { ok: true };
}

async function setWebauthnCredential(credentialId) {
  const email = requireEmail();
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  user.webauthnCredentialId = credentialId;
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").put(user));
  return { ok: true };
}

async function clearWebauthnCredential() {
  const email = requireEmail();
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  user.webauthnCredentialId = null;
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").put(user));
  return { ok: true };
}

function quickUnlockWithWebauthn(email) {
  email = (email || "").trim().toLowerCase();
  localStorage.setItem(SESSION_KEY, email);
  localStorage.setItem(LAST_EMAIL_KEY, email);
}

// ---------- expenses ----------

async function addExpense({ amount, category, payment_mode, note, raw_text, spent_date }) {
  const userEmail = requireEmail();
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  const db = await openDb();
  const record = {
    userEmail, amount, category, payment_mode,
    note: note || null, raw_text: raw_text || null,
    spentDate: spent_date || todayStr(),
    createdAt: new Date().toISOString(),
  };
  const id = await reqToPromise(tx(db, "expenses", "readwrite").objectStore("expenses").add(record));
  return id;
}

async function updateExpense(id, { amount, category, payment_mode, note, spent_date }) {
  const userEmail = requireEmail();
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  const db = await openDb();
  const store = tx(db, "expenses", "readwrite").objectStore("expenses");
  const existing = await reqToPromise(store.get(id));
  if (!existing || existing.userEmail !== userEmail) return false;
  existing.amount = amount;
  existing.category = category;
  existing.payment_mode = payment_mode;
  existing.note = note || null;
  existing.spentDate = spent_date;
  await reqToPromise(store.put(existing));
  return true;
}

async function deleteExpense(id) {
  const userEmail = requireEmail();
  const db = await openDb();
  const store = tx(db, "expenses", "readwrite").objectStore("expenses");
  const existing = await reqToPromise(store.get(id));
  if (!existing || existing.userEmail !== userEmail) return false;
  await reqToPromise(store.delete(id));
  return true;
}

async function allExpensesForUser() {
  const userEmail = requireEmail();
  const db = await openDb();
  const index = tx(db, "expenses", "readonly").objectStore("expenses").index("byUser");
  const rows = await reqToPromise(index.getAll(IDBKeyRange.only(userEmail)));
  return rows.map(toApiShape);
}

function toApiShape(r) {
  return {
    id: r.id, amount: r.amount, category: r.category, payment_mode: r.payment_mode,
    note: r.note, raw_text: r.raw_text, spent_date: r.spentDate, created_at: r.createdAt,
  };
}

async function getDay(date) {
  const spentDate = date || todayStr();
  const all = await allExpensesForUser();
  const expenses = all.filter((e) => e.spent_date === spentDate).sort((a, b) => b.id - a.id);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  return { date: spentDate, expenses, total: Math.round(total * 100) / 100 };
}

async function getMonth(month) {
  const m = month || todayStr().slice(0, 7);
  const all = await allExpensesForUser();
  const expenses = all.filter((e) => e.spent_date.startsWith(m + "-"))
    .sort((a, b) => (a.spent_date < b.spent_date ? -1 : a.spent_date > b.spent_date ? 1 : a.id - b.id));

  const daily = {}, byCategory = {}, byPaymentMode = {};
  for (const e of expenses) {
    daily[e.spent_date] = (daily[e.spent_date] || 0) + e.amount;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    byPaymentMode[e.payment_mode] = (byPaymentMode[e.payment_mode] || 0) + e.amount;
  }
  const round2 = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  const sortByValueDesc = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    month: m, expenses, total: Math.round(total * 100) / 100,
    daily_totals: round2(Object.fromEntries(Object.entries(daily).sort())),
    by_category: round2(sortByValueDesc(byCategory)),
    by_payment_mode: round2(sortByValueDesc(byPaymentMode)),
  };
}

async function getYear(year) {
  const y = year || new Date().getFullYear();
  const all = await allExpensesForUser();
  const expenses = all.filter((e) => e.spent_date.startsWith(`${y}-`));

  const monthly = {};
  for (let m = 1; m <= 12; m++) monthly[`${y}-${String(m).padStart(2, "0")}`] = 0;
  const byCategory = {};
  for (const e of expenses) {
    const m = e.spent_date.slice(0, 7);
    if (m in monthly) monthly[m] += e.amount;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  const round2 = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  const sortByValueDesc = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    year: y, total: Math.round(total * 100) / 100,
    monthly_totals: round2(monthly),
    by_category: round2(sortByValueDesc(byCategory)),
  };
}

async function getTrend(monthsBack) {
  const n = monthsBack || 6;
  const all = await allExpensesForUser();
  const months = [];
  const cursor = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  for (const e of all) {
    const m = e.spent_date.slice(0, 7);
    if (m in totals) totals[m] += e.amount;
  }
  return months.map((m) => ({ month: m, total: Math.round(totals[m] * 100) / 100 }));
}

async function getFrequent(limit) {
  const n = limit || 5;
  const all = await allExpensesForUser();
  const groups = new Map();
  for (const e of all) {
    const key = `${e.amount}|${e.category}|${e.payment_mode}`;
    const g = groups.get(key) || { amount: e.amount, category: e.category, payment_mode: e.payment_mode, note: e.note, count: 0, lastId: 0 };
    g.count += 1;
    if (e.id > g.lastId) { g.lastId = e.id; g.note = e.note; }
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.lastId - a.lastId)
    .slice(0, n);
}

// ---------- category memory (learns corrections to the text parser) ----------

async function rememberCategory(signature, category) {
  if (!signature) return;
  const userEmail = requireEmail();
  const db = await openDb();
  const id = `${userEmail}::${signature}`;
  await reqToPromise(tx(db, "categoryMemory", "readwrite").objectStore("categoryMemory")
    .put({ id, userEmail, signature, category }));
}

async function recallCategory(signature) {
  if (!signature) return null;
  const userEmail = requireEmail();
  const db = await openDb();
  const row = await reqToPromise(tx(db, "categoryMemory", "readonly").objectStore("categoryMemory")
    .get(`${userEmail}::${signature}`));
  return row ? row.category : null;
}

// ---------- budgets ----------

async function setBudget(category, monthlyLimit) {
  const userEmail = requireEmail();
  const db = await openDb();
  const id = `${userEmail}::${category}`;
  await reqToPromise(tx(db, "budgets", "readwrite").objectStore("budgets")
    .put({ id, userEmail, category, monthlyLimit }));
}

async function deleteBudget(category) {
  const userEmail = requireEmail();
  const db = await openDb();
  await reqToPromise(tx(db, "budgets", "readwrite").objectStore("budgets")
    .delete(`${userEmail}::${category}`));
}

async function getBudgets() {
  const userEmail = requireEmail();
  const db = await openDb();
  const index = tx(db, "budgets", "readonly").objectStore("budgets").index("byUser");
  const rows = await reqToPromise(index.getAll(IDBKeyRange.only(userEmail)));
  const byCategory = {};
  let total = null;
  for (const r of rows) {
    if (r.category === TOTAL_BUDGET_CATEGORY) total = r.monthlyLimit;
    else byCategory[r.category] = r.monthlyLimit;
  }
  return { total, byCategory };
}

// ---------- migration helper ----------

async function exportAll() {
  const user = await currentUser();
  const expenses = await allExpensesForUser();
  return { user, expenses, exported_at: new Date().toISOString() };
}

window.DataStore = {
  signup, login, logout, currentUser, resetPassword,
  addExpense, updateExpense, deleteExpense, getDay, getMonth, getYear, getTrend, getFrequent,
  rememberCategory, recallCategory,
  setBudget, deleteBudget, getBudgets, TOTAL_BUDGET_CATEGORY,
  lastEmail, quickUnlockInfo, setPin, clearPin, quickUnlockWithPin,
  setWebauthnCredential, clearWebauthnCredential, quickUnlockWithWebauthn,
  exportAll,
};
