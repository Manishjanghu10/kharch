const $ = (id) => document.getElementById(id);

let editingId = null;
let dayExpensesById = {};
let dayIncomeById = {};
let dayTotalValue = 0;
let dayIncomeTotalValue = 0;
let multiCandidates = [];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function currentMonthStr() { return todayStr().slice(0, 7); }
function fmtMoney(n) { return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fillSelect(sel, options) {
  sel.innerHTML = options.map((o) => `<option value="${o}">${o}</option>`).join('');
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

let toastTimer = null;
function showToast(msg, actionLabel, actionFn) {
  const t = $('toast');
  clearTimeout(toastTimer);
  t.innerHTML = escapeHtml(msg);
  if (actionLabel && actionFn) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.style.cssText = 'margin-left:10px;background:none;border:none;color:var(--accent);font-weight:700;padding:0;cursor:pointer;';
    btn.addEventListener('click', () => { actionFn(); t.classList.remove('show'); });
    t.appendChild(btn);
  }
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 4500 : 2200);
}

fillSelect($('fPaymentMode'), Parser.PAYMENT_MODES);

let entryType = 'expense';
let editingType = 'expense';
let typeManuallySet = false;

function setEntryType(type) {
  entryType = type;
  $('typeExpenseBtn').classList.toggle('active', type === 'expense');
  $('typeIncomeBtn').classList.toggle('active', type === 'income');
  if (type === 'income') {
    fillSelect($('fCategory'), Parser.INCOME_SOURCES);
    $('fCategoryLabel').textContent = 'Source';
  } else {
    fillSelect($('fCategory'), Parser.CATEGORIES);
    $('fCategoryLabel').textContent = 'Category';
  }
}
setEntryType('expense');

$('typeExpenseBtn').addEventListener('click', () => { typeManuallySet = true; setEntryType('expense'); });
$('typeIncomeBtn').addEventListener('click', () => { typeManuallySet = true; setEntryType('income'); });

const DEFAULT_MIC_HINT = 'Tap the mic and say it, or type it, then tap Parse. You can even say "500 on lunch and 200 on auto", or "10000 salary received by bank transfer".';

// ---------- auth bootstrap ----------
async function checkAuth() {
  const user = await DataStore.currentUser();
  if (!user) { window.location.href = 'login.html'; return false; }
  $('userName').textContent = user.name;
  return true;
}

$('logoutBtn').addEventListener('click', () => {
  DataStore.logout();
  window.location.href = 'login.html';
});

// ---------- settings panel ----------
$('settingsBtn').addEventListener('click', async () => {
  const card = $('settingsCard');
  const showing = card.style.display !== 'none';
  card.style.display = showing ? 'none' : 'block';
  if (!showing) await renderSettings();
});

async function renderSettings() {
  const user = await DataStore.currentUser();
  const info = await DataStore.quickUnlockInfo(user.email);

  $('pinToggleBtn').textContent = info.hasPin ? 'Change PIN' : 'Set PIN';
  $('pinRemoveBtn').style.display = info.hasPin ? 'inline' : 'none';

  const webauthnAvailable = await Webauthn.isAvailable();
  $('webauthnRow').style.display = webauthnAvailable ? 'flex' : 'none';
  $('webauthnToggleBtn').textContent = info.hasWebauthn ? 'Disable' : 'Enable';

  await renderBudgetEditList();
}

$('pinToggleBtn').addEventListener('click', openPinSetup);
$('pinRemoveBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await DataStore.clearPin();
  showToast('PIN removed.');
  renderSettings();
});

$('webauthnToggleBtn').addEventListener('click', async () => {
  const user = await DataStore.currentUser();
  const info = await DataStore.quickUnlockInfo(user.email);
  try {
    if (info.hasWebauthn) {
      await DataStore.clearWebauthnCredential();
      showToast('Biometric unlock disabled.');
    } else {
      const credentialId = await Webauthn.register(user.email, user.name);
      await DataStore.setWebauthnCredential(credentialId);
      showToast('Biometric unlock enabled.');
    }
  } catch (e) {
    showToast('Could not set up biometric unlock on this device.');
  }
  renderSettings();
});

function openPinSetup() {
  $('settingsCard').style.display = 'none';
  $('pinScreen').style.display = 'block';
  $('pinScreenTitle').textContent = 'Set a PIN';
  $('pinScreenSub').textContent = 'Choose 4 digits.';
  $('pinError').textContent = '';
  let firstPin = null;
  const pad = PinPad.buildPinPad($('pinKeypad'), $('pinDots'), 4, async (pin) => {
    if (firstPin === null) {
      firstPin = pin;
      $('pinScreenTitle').textContent = 'Confirm your PIN';
      $('pinScreenSub').textContent = 'Enter the same 4 digits again.';
      pad.reset();
      return;
    }
    if (pin !== firstPin) {
      $('pinError').textContent = "PINs didn't match -- try again.";
      firstPin = null;
      $('pinScreenTitle').textContent = 'Set a PIN';
      $('pinScreenSub').textContent = 'Choose 4 digits.';
      pad.reset();
      return;
    }
    const result = await DataStore.setPin(pin);
    closePinSetup();
    if (result.ok) { showToast('PIN set.'); renderSettings(); }
    else showToast(result.error);
  });
}
function closePinSetup() {
  $('pinScreen').style.display = 'none';
  $('settingsCard').style.display = 'block';
}
$('pinCancel').addEventListener('click', (e) => { e.preventDefault(); closePinSetup(); });

async function renderBudgetEditList() {
  const budgets = await DataStore.getBudgets();
  const rows = [{ key: DataStore.TOTAL_BUDGET_CATEGORY, label: 'Overall (all categories)' },
    ...Parser.CATEGORIES.map((c) => ({ key: c, label: c }))];
  $('budgetEditList').innerHTML = rows.map((r) => {
    const value = r.key === DataStore.TOTAL_BUDGET_CATEGORY ? budgets.total : budgets.byCategory[r.key];
    return `
      <div class="budget-edit-row">
        <span>${escapeHtml(r.label)}</span>
        <input type="number" min="0" step="1" class="budget-input" data-key="${escapeHtml(r.key)}" placeholder="No limit" value="${value ?? ''}">
      </div>`;
  }).join('');
  $('budgetEditList').querySelectorAll('.budget-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.key;
      const value = parseFloat(input.value);
      if (value > 0) await DataStore.setBudget(key, value);
      else await DataStore.deleteBudget(key);
      loadMonth();
    });
  });
}

$('exportJsonLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const data = await DataStore.exportAll();
  downloadFile(`kharch-export-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
});
$('exportCsvLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const data = await DataStore.exportAll();
  const header = ['type', 'date', 'amount', 'category_or_source', 'payment_mode', 'note', 'raw_text'];
  const csvEscape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const expenseRows = data.expenses.map((x) => ['expense', x.spent_date, x.amount, x.category, x.payment_mode, x.note, x.raw_text]);
  const incomeRows = data.income.map((x) => ['income', x.received_date, x.amount, x.source, x.payment_mode, x.note, x.raw_text]);
  const csv = [header.join(','), ...[...expenseRows, ...incomeRows].map((r) => r.map(csvEscape).join(','))].join('\n');
  downloadFile(`kharch-export-${todayStr()}.csv`, csv, 'text/csv');
});

$('importLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('importFileInput').click();
});
$('importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file later
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!data || (!Array.isArray(data.expenses) && !Array.isArray(data.income))) throw new Error('not a Kharch export');
  } catch (err) {
    showToast("That doesn't look like a valid Kharch export file.");
    return;
  }
  const expenseCount = (data.expenses || []).length;
  const incomeCount = (data.income || []).length;
  if (!expenseCount && !incomeCount) { showToast('No entries found in that file.'); return; }

  const who = data.user ? `${data.user.name} (${data.user.email})` : 'unknown account';
  const when = data.exported_at ? new Date(data.exported_at).toLocaleDateString() : 'an unknown date';
  const wantParts = [];
  if (expenseCount) wantParts.push(`${expenseCount} expense(s)`);
  if (incomeCount) wantParts.push(`${incomeCount} income entr${incomeCount === 1 ? 'y' : 'ies'}`);
  const ok = confirm(`Import ${wantParts.join(' and ')} from a backup of ${who}, exported ${when}?\n\nThey'll be added to your current account on this device.`);
  if (!ok) return;

  const result = await DataStore.importData(data);
  const gotParts = [];
  if (expenseCount) gotParts.push(`${result.addedExpenses} expense${result.addedExpenses === 1 ? '' : 's'}` +
    (result.skippedExpenses ? ` (${result.skippedExpenses} duplicate skipped)` : ''));
  if (incomeCount) gotParts.push(`${result.addedIncome} income entr${result.addedIncome === 1 ? 'y' : 'ies'}` +
    (result.skippedIncome ? ` (${result.skippedIncome} duplicate skipped)` : ''));
  showToast(`Imported ${gotParts.join(', ')}.`);
  loadDay(); loadMonth(); renderChips();
});

// ---------- frequent-expense quick-add chips ----------
async function renderChips() {
  const frequent = await DataStore.getFrequent(5);
  const row = $('chipRow');
  if (!frequent.length) { row.style.display = 'none'; row.innerHTML = ''; return; }
  row.style.display = 'flex';
  row.innerHTML = frequent.map((f, i) =>
    `<button type="button" class="chip" data-idx="${i}">${fmtMoney(f.amount)} · ${escapeHtml(f.category)} · ${escapeHtml(f.payment_mode)}</button>`
  ).join('');
  row.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => quickAddFrequent(frequent[+btn.dataset.idx]));
  });
}

async function quickAddFrequent(f) {
  try {
    const id = await DataStore.addExpense({
      amount: f.amount, category: f.category, payment_mode: f.payment_mode,
      note: f.note, raw_text: null, spent_date: todayStr(),
    });
    loadDay(); loadMonth();
    showToast(`Added ${fmtMoney(f.amount)} · ${f.category}`, 'Undo', async () => {
      await DataStore.deleteExpense(id);
      loadDay(); loadMonth();
    });
  } catch (e) {
    showToast(e.message || 'Could not add expense.');
  }
}

// ---------- voice dictation ----------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recording = false;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    $('dictateText').value = text;
    doParse();
  };
  recognition.onerror = () => { $('micHint').textContent = 'Could not hear that clearly -- try again or type it.'; };
  recognition.onend = () => { recording = false; $('micBtn').classList.remove('recording'); };
} else {
  $('micHint').textContent = "Tap the text field, then use your keyboard's dictation mic to speak it in.";
}

$('micBtn').addEventListener('click', () => {
  if (!recognition) { $('dictateText').focus(); return; }
  if (recording) { recognition.stop(); return; }
  recording = true;
  $('micBtn').classList.add('recording');
  $('micHint').textContent = 'Listening...';
  recognition.start();
});

// ---------- parse & confirm (single or multi-item) ----------
async function applyMemory(parsed) {
  const sig = Parser.computeSignature(parsed.raw_text);
  if (sig) {
    const learned = await DataStore.recallCategory(sig);
    if (learned) parsed.category = learned;
  }
  return parsed;
}

async function doParse() {
  const text = $('dictateText').value.trim();
  if (!text) { showToast('Say or type an entry first.'); return; }
  const lower = text.toLowerCase();
  if (!typeManuallySet) {
    setEntryType(Parser.detectIncome(lower) ? 'income' : 'expense');
  }

  if (entryType === 'expense') {
    const candidates = Parser.parseExpenseTextMulti(text);
    if (candidates.length > 1) {
      for (const c of candidates) await applyMemory(c);
      renderMultiConfirm(candidates);
      return;
    }
  }

  const parsed = Parser.parseEntryText(text, entryType);
  if (parsed.amount === null) {
    showToast('Could not find an amount in that.');
    return;
  }
  if (parsed.type === 'income') {
    renderSingleConfirmIncome(parsed);
  } else {
    await applyMemory(parsed);
    renderSingleConfirm(parsed);
  }
}
$('parseBtn').addEventListener('click', doParse);
$('cancelBtn').addEventListener('click', resetForm);

function renderSingleConfirm(c) {
  $('multiConfirmBlock').style.display = 'none';
  $('fAmount').value = c.amount ?? '';
  $('fCategory').value = c.category || 'Other';
  $('fPaymentMode').value = c.payment_mode || 'Cash';
  $('fNote').value = '';
  $('fDate').value = editingId ? ($('fDate').value || todayStr()) : (c.spent_date_guess || todayStr());
  $('confirmBlock').style.display = 'block';
  $('saveBtn').textContent = editingId ? 'Update expense' : 'Save expense';
  $('micHint').textContent = 'Check the details below, then save.';
}

function renderSingleConfirmIncome(c) {
  $('multiConfirmBlock').style.display = 'none';
  $('fAmount').value = c.amount ?? '';
  $('fCategory').value = c.source || 'Other';
  $('fPaymentMode').value = c.payment_mode || 'Cash';
  $('fNote').value = '';
  $('fDate').value = editingId ? ($('fDate').value || todayStr()) : (c.spent_date_guess || todayStr());
  $('confirmBlock').style.display = 'block';
  $('saveBtn').textContent = editingId ? 'Update income' : 'Save income';
  $('micHint').textContent = 'Check the details below, then save.';
}

function resetForm() {
  editingId = null;
  editingType = 'expense';
  typeManuallySet = false;
  setEntryType('expense');
  $('dictateText').value = '';
  $('confirmBlock').style.display = 'none';
  $('saveBtn').textContent = 'Save expense';
  $('micHint').textContent = DEFAULT_MIC_HINT;
}

$('saveBtn').addEventListener('click', async () => {
  const amount = parseFloat($('fAmount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount.'); return; }
  const selectValue = $('fCategory').value;
  const payment_mode = $('fPaymentMode').value;
  const note = $('fNote').value || null;
  const date = $('fDate').value || todayStr();
  const raw_text = $('dictateText').value || null;
  try {
    if (entryType === 'income') {
      if (editingId && editingType === 'income') {
        const ok = await DataStore.updateIncome(editingId, { amount, source: selectValue, payment_mode, note, received_date: date });
        if (!ok) throw new Error('Entry not found.');
      } else {
        await DataStore.addIncome({ amount, source: selectValue, payment_mode, note, raw_text, received_date: date });
      }
    } else {
      if (editingId && editingType === 'expense') {
        const ok = await DataStore.updateExpense(editingId, { amount, category: selectValue, payment_mode, note, spent_date: date });
        if (!ok) throw new Error('Expense not found.');
      } else {
        await DataStore.addExpense({ amount, category: selectValue, payment_mode, note, raw_text, spent_date: date });
      }
      const sig = Parser.computeSignature(raw_text);
      if (sig) await DataStore.rememberCategory(sig, selectValue);
    }
  } catch (e) {
    showToast(e.message || 'Could not save.');
    return;
  }
  showToast(editingId ? 'Entry updated.' : (entryType === 'income' ? 'Income saved.' : 'Expense saved.'));
  resetForm();
  loadDay(); loadMonth(); renderChips();
});

function startEditById(id) { startEdit(dayExpensesById[id]); }
function startEdit(exp) {
  editingId = exp.id;
  editingType = 'expense';
  typeManuallySet = true;
  setEntryType('expense');
  $('multiConfirmBlock').style.display = 'none';
  $('dictateText').value = exp.raw_text || '';
  $('fAmount').value = exp.amount;
  $('fCategory').value = exp.category;
  $('fPaymentMode').value = exp.payment_mode;
  $('fNote').value = exp.note || '';
  $('fDate').value = exp.spent_date;
  $('confirmBlock').style.display = 'block';
  $('saveBtn').textContent = 'Update expense';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startEditIncomeById(id) { startEditIncome(dayIncomeById[id]); }
function startEditIncome(inc) {
  editingId = inc.id;
  editingType = 'income';
  typeManuallySet = true;
  setEntryType('income');
  $('multiConfirmBlock').style.display = 'none';
  $('dictateText').value = inc.raw_text || '';
  $('fAmount').value = inc.amount;
  $('fCategory').value = inc.source;
  $('fPaymentMode').value = inc.payment_mode;
  $('fNote').value = inc.note || '';
  $('fDate').value = inc.received_date;
  $('confirmBlock').style.display = 'block';
  $('saveBtn').textContent = 'Update income';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- multi-item confirm ----------
function renderMultiConfirm(candidates) {
  $('confirmBlock').style.display = 'none';
  multiCandidates = candidates.map((c) => ({ ...c }));
  $('multiHint').textContent = `Found ${multiCandidates.length} expenses in that -- check each, then save all.`;
  renderMultiRows();
  $('multiConfirmBlock').style.display = 'block';
}

function renderMultiRows() {
  const container = $('multiRows');
  container.innerHTML = multiCandidates.map((c, i) => `
    <div class="multi-row" data-idx="${i}">
      <button type="button" class="btn-danger remove-row" data-idx="${i}">✕</button>
      <div class="parse-grid">
        <div><label>Amount (₹)</label><input type="number" step="0.01" min="0" class="m-amount" data-idx="${i}" value="${c.amount ?? ''}"></div>
        <div><label>Date</label><input type="date" class="m-date" data-idx="${i}" value="${c.spent_date_guess || todayStr()}"></div>
        <div><label>Category</label><select class="m-category" data-idx="${i}"></select></div>
        <div><label>Payment mode</label><select class="m-payment" data-idx="${i}"></select></div>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('.m-category').forEach((sel) => {
    fillSelect(sel, Parser.CATEGORIES);
    sel.value = multiCandidates[+sel.dataset.idx].category || 'Other';
  });
  container.querySelectorAll('.m-payment').forEach((sel) => {
    fillSelect(sel, Parser.PAYMENT_MODES);
    sel.value = multiCandidates[+sel.dataset.idx].payment_mode || 'Cash';
  });
  container.querySelectorAll('.remove-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      multiCandidates.splice(+btn.dataset.idx, 1);
      if (!multiCandidates.length) { resetMultiForm(); return; }
      renderMultiRows();
    });
  });
}

$('saveAllBtn').addEventListener('click', async () => {
  const container = $('multiRows');
  let savedCount = 0;
  for (const input of [...container.querySelectorAll('.m-amount')]) {
    const idx = +input.dataset.idx;
    const c = multiCandidates[idx];
    const amount = parseFloat(input.value);
    if (!amount || amount <= 0) continue;
    const category = container.querySelector(`.m-category[data-idx="${idx}"]`).value;
    const payment_mode = container.querySelector(`.m-payment[data-idx="${idx}"]`).value;
    const spent_date = container.querySelector(`.m-date[data-idx="${idx}"]`).value || todayStr();
    await DataStore.addExpense({ amount, category, payment_mode, note: null, raw_text: c.raw_text, spent_date });
    const sig = Parser.computeSignature(c.raw_text);
    if (sig) await DataStore.rememberCategory(sig, category);
    savedCount++;
  }
  showToast(`Saved ${savedCount} expense${savedCount === 1 ? '' : 's'}.`);
  resetMultiForm();
  loadDay(); loadMonth(); renderChips();
});
$('multiCancelBtn').addEventListener('click', resetMultiForm);
function resetMultiForm() {
  multiCandidates = [];
  typeManuallySet = false;
  setEntryType('expense');
  $('multiConfirmBlock').style.display = 'none';
  $('dictateText').value = '';
  $('micHint').textContent = DEFAULT_MIC_HINT;
}

// ---------- swipe-to-delete + undo ----------
function attachSwipe(fgEl, id, type) {
  let startX = 0, dx = 0, dragging = false;
  const threshold = -70, maxReveal = -90;
  fgEl.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    dragging = true;
    fgEl.classList.remove('snap');
    fgEl.classList.add('dragging');
  }, { passive: true });
  fgEl.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dx = Math.max(maxReveal, Math.min(0, e.touches[0].clientX - startX));
    fgEl.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  fgEl.addEventListener('touchend', () => {
    dragging = false;
    fgEl.classList.remove('dragging');
    fgEl.classList.add('snap');
    if (dx < threshold) {
      fgEl.style.transform = 'translateX(-100%)';
      setTimeout(() => (type === 'income' ? deleteIncome(id) : deleteExpense(id)), 150);
    } else {
      fgEl.style.transform = 'translateX(0)';
    }
    dx = 0;
  });
}

function updateDayStatDisplays() {
  $('dayTotal').textContent = fmtMoney(dayTotalValue);
  $('dayIncomeTotal').textContent = fmtMoney(dayIncomeTotalValue);
  const net = Math.round((dayIncomeTotalValue - dayTotalValue) * 100) / 100;
  const netEl = $('dayNet');
  netEl.textContent = fmtMoney(net);
  netEl.className = 'stat-value ' + (net >= 0 ? 'positive' : 'negative');
}

function noEntriesLeftInDayList() {
  if (!document.querySelector('#dayList .swipe-container')) {
    $('dayList').innerHTML = '<div class="empty">No entries logged for this day.</div>';
  }
}

async function deleteExpense(id) {
  const exp = dayExpensesById[id];
  if (!exp) return;
  const rowEl = document.querySelector(`.swipe-container[data-row-id="expense-${id}"]`);
  if (rowEl) rowEl.remove();
  dayTotalValue = Math.max(0, dayTotalValue - exp.amount);
  delete dayExpensesById[id];
  updateDayStatDisplays();
  noEntriesLeftInDayList();
  const timeoutId = setTimeout(async () => {
    await DataStore.deleteExpense(id);
    loadMonth();
    renderChips();
  }, 4000);
  showToast('Expense deleted', 'Undo', () => {
    clearTimeout(timeoutId);
    loadDay();
  });
}

async function deleteIncome(id) {
  const inc = dayIncomeById[id];
  if (!inc) return;
  const rowEl = document.querySelector(`.swipe-container[data-row-id="income-${id}"]`);
  if (rowEl) rowEl.remove();
  dayIncomeTotalValue = Math.max(0, dayIncomeTotalValue - inc.amount);
  delete dayIncomeById[id];
  updateDayStatDisplays();
  noEntriesLeftInDayList();
  const timeoutId = setTimeout(async () => {
    await DataStore.deleteIncome(id);
    loadMonth();
  }, 4000);
  showToast('Income deleted', 'Undo', () => {
    clearTimeout(timeoutId);
    loadDay();
  });
}

// ---------- tabs ----------
function setActiveTab(tab) {
  $('tabDay').classList.toggle('active', tab === 'day');
  $('tabMonth').classList.toggle('active', tab === 'month');
  $('tabYear').classList.toggle('active', tab === 'year');
  $('dayPanel').style.display = tab === 'day' ? 'block' : 'none';
  $('monthPanel').style.display = tab === 'month' ? 'block' : 'none';
  $('yearPanel').style.display = tab === 'year' ? 'block' : 'none';
}
$('tabDay').addEventListener('click', () => setActiveTab('day'));
$('tabMonth').addEventListener('click', () => { setActiveTab('month'); loadMonth(); });
$('tabYear').addEventListener('click', () => { setActiveTab('year'); loadYear(); });

// ---------- day view ----------
$('dayPicker').value = todayStr();
async function loadDay() {
  const date = $('dayPicker').value || todayStr();
  const data = await DataStore.getDay(date);
  dayTotalValue = data.total;
  dayIncomeTotalValue = data.total_income;
  updateDayStatDisplays();

  dayExpensesById = Object.fromEntries(data.expenses.map((e) => [e.id, e]));
  dayIncomeById = Object.fromEntries(data.income.map((e) => [e.id, e]));

  const combined = [
    ...data.expenses.map((e) => ({ ...e, _type: 'expense' })),
    ...data.income.map((e) => ({ ...e, _type: 'income' })),
  ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const list = $('dayList');
  if (!combined.length) {
    list.innerHTML = '<div class="empty">No entries logged for this day.</div>';
    return;
  }
  list.innerHTML = combined.map((e) => {
    const isIncome = e._type === 'income';
    const label = isIncome ? e.source : e.category;
    const amountText = (isIncome ? '+' : '') + fmtMoney(e.amount);
    const editFn = isIncome ? `startEditIncomeById(${e.id})` : `startEditById(${e.id})`;
    const deleteFn = isIncome ? `deleteIncome(${e.id})` : `deleteExpense(${e.id})`;
    return `
    <div class="swipe-container" data-row-id="${e._type}-${e.id}">
      <div class="swipe-bg">Delete</div>
      <div class="swipe-fg snap">
        <div class="expense-row${isIncome ? ' income-row' : ''}">
          <div>
            <div><span class="amount">${amountText}</span></div>
            <div class="meta"><span class="cat-tag">${escapeHtml(label)}</span>${escapeHtml(e.payment_mode)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
          </div>
          <div class="expense-actions">
            <button onclick="${editFn}">Edit</button>
            <button class="btn-danger" onclick="${deleteFn}">Delete</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.swipe-container').forEach((container) => {
    const [type, idStr] = container.dataset.rowId.split('-');
    attachSwipe(container.querySelector('.swipe-fg'), +idStr, type);
  });
}
$('dayPicker').addEventListener('change', loadDay);
$('dayPrev').addEventListener('click', () => {
  const [y, m, d] = $('dayPicker').value.split('-').map(Number);
  const nd = new Date(y, m - 1, d - 1);
  $('dayPicker').value = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
  loadDay();
});
$('dayNext').addEventListener('click', () => {
  const [y, m, d] = $('dayPicker').value.split('-').map(Number);
  const nd = new Date(y, m - 1, d + 1);
  $('dayPicker').value = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
  loadDay();
});

// ---------- month view ----------
function shortMonthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}
function budgetBarClass(ratio) {
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return '';
}

$('monthPicker').value = currentMonthStr();
async function loadMonth() {
  const month = $('monthPicker').value || currentMonthStr();
  const data = await DataStore.getMonth(month);
  $('monthTotal').textContent = fmtMoney(data.total);
  $('monthIncomeTotal').textContent = fmtMoney(data.total_income);
  const monthNetEl = $('monthNet');
  monthNetEl.textContent = fmtMoney(data.net);
  monthNetEl.className = 'stat-value ' + (data.net >= 0 ? 'positive' : 'negative');

  const sourceEntries = Object.entries(data.by_source || {});
  if (sourceEntries.length) {
    $('monthIncomeCard').style.display = 'block';
    $('monthIncomeBySource').innerHTML = sourceEntries.map(([s, v]) => `
      <div class="breakdown-row"><span>${escapeHtml(s)}</span><span>${fmtMoney(v)}</span></div>`).join('');
  } else {
    $('monthIncomeCard').style.display = 'none';
  }

  const budgets = await DataStore.getBudgets();
  const catBudgetEntries = Object.entries(budgets.byCategory || {});
  if (budgets.total || catBudgetEntries.length) {
    $('budgetCard').style.display = 'block';
    let html = '';
    if (budgets.total) {
      const ratio = data.total / budgets.total;
      html += `
        <div class="budget-row">
          <div class="budget-label"><span>Overall</span><span class="${ratio >= 1 ? 'over-text' : ''}">${fmtMoney(data.total)} / ${fmtMoney(budgets.total)}</span></div>
          <div class="budget-track"><div class="budget-fill ${budgetBarClass(ratio)}" style="width:${Math.min(100, ratio * 100)}%"></div></div>
        </div>`;
    }
    for (const [cat, limit] of catBudgetEntries) {
      const spent = data.by_category[cat] || 0;
      const ratio = spent / limit;
      html += `
        <div class="budget-row">
          <div class="budget-label"><span>${escapeHtml(cat)}</span><span class="${ratio >= 1 ? 'over-text' : ''}">${fmtMoney(spent)} / ${fmtMoney(limit)}</span></div>
          <div class="budget-track"><div class="budget-fill ${budgetBarClass(ratio)}" style="width:${Math.min(100, ratio * 100)}%"></div></div>
        </div>`;
    }
    $('budgetProgress').innerHTML = html;
  } else {
    $('budgetCard').style.display = 'none';
  }

  const dailyEntries = Object.entries(data.daily_totals);
  const maxDaily = Math.max(1, ...dailyEntries.map(([, v]) => v));
  $('monthDaily').innerHTML = dailyEntries.length
    ? dailyEntries.map(([day, v]) => `
        <div class="day-total-row">
          <span>${day.slice(8)}</span>
          <div class="bar-wrap"><div class="bar" style="width:${(v / maxDaily) * 100}%"></div></div>
          <span>${fmtMoney(v)}</span>
        </div>`).join('')
    : '<div class="empty">No expenses this month yet.</div>';

  const catEntries = Object.entries(data.by_category).map(([label, value]) => ({ label, value }));
  Charts.drawDonut($('categoryDonut'), catEntries);
  const catTotal = catEntries.reduce((s, e) => s + e.value, 0);
  $('categoryLegend').innerHTML = catEntries.length
    ? catEntries.map((e, i) => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${Charts.PALETTE[i % Charts.PALETTE.length]}"></span>
          <span>${escapeHtml(e.label)}</span>
          <span>${catTotal ? Math.round((e.value / catTotal) * 100) : 0}%</span>
        </div>`).join('')
    : '<div class="empty">No data yet.</div>';

  const trend = await DataStore.getTrend(6);
  Charts.drawTrendBars($('trendChart'), trend.map((t) => ({ label: shortMonthLabel(t.month), value: t.total })));

  $('monthPaymentMode').innerHTML = Object.entries(data.by_payment_mode).length
    ? Object.entries(data.by_payment_mode).map(([p, v]) => `
        <div class="breakdown-row"><span>${escapeHtml(p)}</span><span>${fmtMoney(v)}</span></div>`).join('')
    : '<div class="empty">No data yet.</div>';
}
$('monthPicker').addEventListener('change', loadMonth);
$('monthPrev').addEventListener('click', () => {
  const [y, m] = $('monthPicker').value.split('-').map(Number);
  const nd = new Date(y, m - 2, 1);
  $('monthPicker').value = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`;
  loadMonth();
});
$('monthNext').addEventListener('click', () => {
  const [y, m] = $('monthPicker').value.split('-').map(Number);
  const nd = new Date(y, m, 1);
  $('monthPicker').value = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`;
  loadMonth();
});

// ---------- year view ----------
let currentYear = new Date().getFullYear();
function monthShortFromNum(m) { return new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }); }

async function loadYear() {
  const data = await DataStore.getYear(currentYear);
  $('yearLabel').textContent = String(currentYear);
  $('yearTotal').textContent = fmtMoney(data.total);
  $('yearIncomeTotal').textContent = fmtMoney(data.total_income);
  const yearNetEl = $('yearNet');
  yearNetEl.textContent = fmtMoney(data.net);
  yearNetEl.className = 'stat-value ' + (data.net >= 0 ? 'positive' : 'negative');

  const entries = Object.entries(data.monthly_totals).map(([m, v]) => ({ label: monthShortFromNum(+m.slice(5)), value: v }));
  const thisYear = new Date().getFullYear();
  const highlightIndex = currentYear === thisYear ? new Date().getMonth() : -1;
  Charts.drawTrendBars($('yearMonthlyChart'), entries, highlightIndex);

  $('yearCategory').innerHTML = Object.entries(data.by_category).length
    ? Object.entries(data.by_category).map(([c, v]) => `
        <div class="breakdown-row"><span>${escapeHtml(c)}</span><span>${fmtMoney(v)}</span></div>`).join('')
    : '<div class="empty">No data yet.</div>';

  const sourceEntries = Object.entries(data.by_source || {});
  if (sourceEntries.length) {
    $('yearIncomeCard').style.display = 'block';
    $('yearIncomeSource').innerHTML = sourceEntries.map(([s, v]) => `
      <div class="breakdown-row"><span>${escapeHtml(s)}</span><span>${fmtMoney(v)}</span></div>`).join('');
  } else {
    $('yearIncomeCard').style.display = 'none';
  }
}
$('yearPrev').addEventListener('click', () => { currentYear -= 1; loadYear(); });
$('yearNext').addEventListener('click', () => { currentYear += 1; loadYear(); });

// ---------- init ----------
window.startEditById = startEditById;
window.startEditIncomeById = startEditIncomeById;
window.deleteExpense = deleteExpense;
window.deleteIncome = deleteIncome;
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }
checkAuth().then((loggedIn) => { if (loggedIn) { loadDay(); loadMonth(); renderChips(); } });
