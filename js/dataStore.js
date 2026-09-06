/* All persistence for Kharch, fully client-side (IndexedDB + localStorage
   for the session flag). This is the ONLY file that talks to storage --
   every page calls DataStore.* functions, never IndexedDB directly. If
   this ever moves to a real backend, only this file needs to change (swap
   the bodies below for fetch() calls); index.html/login.html/signup.html
   and their scripts should not need to change at all. */

const DB_NAME = "kharch_db";
const DB_VERSION = 1;
const SESSION_KEY = "kharch_session_email";

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
  const user = { email, name, phone, saltB64, hashB64, createdAt: new Date().toISOString() };
  await reqToPromise(tx(db, "users", "readwrite").objectStore("users").add(user));
  localStorage.setItem(SESSION_KEY, email);
  return { ok: true };
}

async function login({ email, password }) {
  email = (email || "").trim().toLowerCase();
  const db = await openDb();
  const user = await reqToPromise(tx(db, "users", "readonly").objectStore("users").get(email));
  if (!user) return { ok: false, error: "Incorrect email or password." };
  const valid = await Crypto.verifyPassword(password, user.saltB64, user.hashB64);
  if (!valid) return { ok: false, error: "Incorrect email or password." };
  localStorage.setItem(SESSION_KEY, email);
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

// ---------- migration helper ----------

async function exportAll() {
  const user = await currentUser();
  const expenses = await allExpensesForUser();
  return { user, expenses, exported_at: new Date().toISOString() };
}

window.DataStore = {
  signup, login, logout, currentUser,
  addExpense, updateExpense, deleteExpense, getDay, getMonth,
  exportAll,
};
