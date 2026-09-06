const $ = (id) => document.getElementById(id);

let editingId = null;
let dayExpensesById = {};
let dayTotalValue = 0;
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

fillSelect($('fCategory'), Parser.CATEGORIES);
fillSelect($('fPaymentMode'), Parser.PAYMENT_MODES);

const DEFAULT_MIC_HINT = 'Tap the mic and say it, or type it, then tap Parse. You can even say "500 on lunch and 200 on auto".';

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
  const header = ['date', 'amount', 'category', 'payment_mode', 'note', 'raw_text'];
  const csvEscape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = data.expenses.map((x) => [x.spent_date, x.amount, x.category, x.payment_mode, x.note, x.raw_text]);
  const csv = [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');
  downloadFile(`kharch-export-${todayStr()}.csv`, csv, 'text/csv');
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
  if (!text) { showToast('Say or type an expense first.'); return; }
  const candidates = Parser.parseExpenseTextMulti(text);
  if (!candidates.length || candidates[0].amount === null) {
    showToast('Could not find an amount in that.');
    return;
  }
  for (const c of candidates) await applyMemory(c);

  if (candidates.length === 1) renderSingleConfirm(candidates[0]);
  else renderMultiConfirm(candidates);
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
  $('micHint').textContent = 'Check the details below, then save.';
}

function resetForm() {
  editingId = null;
  $('dictateText').value = '';
  $('confirmBlock').style.display = 'none';
  $('saveBtn').textContent = 'Save expense';
  $('micHint').textContent = DEFAULT_MIC_HINT;
}

$('saveBtn').addEventListener('click', async () => {
  const amount = parseFloat($('fAmount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount.'); return; }
  const category = $('fCategory').value;
  const body = {
    amount, category,
    payment_mode: $('fPaymentMode').value,
    note: $('fNote').value || null,
    spent_date: $('fDate').value || todayStr(),
    raw_text: $('dictateText').value || null,
  };
  try {
    if (editingId) {
      const ok = await DataStore.updateExpense(editingId, body);
      if (!ok) throw new Error('Expense not found.');
    } else {
      await DataStore.addExpense(body);
    }
    const sig = Parser.computeSignature(body.raw_text);
    if (sig) await DataStore.rememberCategory(sig, category);
  } catch (e) {
    showToast(e.message || 'Could not save expense.');
    return;
  }
  showToast(editingId ? 'Expense updated.' : 'Expense saved.');
  resetForm();
  loadDay(); loadMonth(); renderChips();
});

function startEditById(id) { startEdit(dayExpensesById[id]); }
function startEdit(exp) {
  editingId = exp.id;
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
  $('multiConfirmBlock').style.display = 'none';
  $('dictateText').value = '';
  $('micHint').textContent = DEFAULT_MIC_HINT;
}

// ---------- swipe-to-delete + undo ----------
function attachSwipe(fgEl, id) {
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
      setTimeout(() => deleteExpense(id), 150);
    } else {
      fgEl.style.transform = 'translateX(0)';
    }
    dx = 0;
  });
}

async function deleteExpense(id) {
  const exp = dayExpensesById[id];
  if (!exp) return;
  const rowEl = document.querySelector(`.swipe-container[data-row-id="${id}"]`);
  if (rowEl) rowEl.remove();
  dayTotalValue = Math.max(0, dayTotalValue - exp.amount);
  $('dayTotal').textContent = fmtMoney(dayTotalValue);
  delete dayExpensesById[id];
  if (!Object.keys(dayExpensesById).length) {
    $('dayList').innerHTML = '<div class="empty">No expenses logged for this day.</div>';
  }
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
  $('dayTotal').textContent = fmtMoney(dayTotalValue);
  const list = $('dayList');
  dayExpensesById = Object.fromEntries(data.expenses.map((e) => [e.id, e]));
  if (!data.expenses.length) {
    list.innerHTML = '<div class="empty">No expenses logged for this day.</div>';
    return;
  }
  list.innerHTML = data.expenses.map((e) => `
    <div class="swipe-container" data-row-id="${e.id}">
      <div class="swipe-bg">Delete</div>
      <div class="swipe-fg snap">
        <div class="expense-row">
          <div>
            <div><span class="amount">${fmtMoney(e.amount)}</span></div>
            <div class="meta"><span class="cat-tag">${escapeHtml(e.category)}</span>${escapeHtml(e.payment_mode)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
          </div>
          <div class="expense-actions">
            <button onclick="startEditById(${e.id})">Edit</button>
            <button class="btn-danger" onclick="deleteExpense(${e.id})">Delete</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.swipe-container').forEach((container) => {
    attachSwipe(container.querySelector('.swipe-fg'), +container.dataset.rowId);
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

  const entries = Object.entries(data.monthly_totals).map(([m, v]) => ({ label: monthShortFromNum(+m.slice(5)), value: v }));
  const thisYear = new Date().getFullYear();
  const highlightIndex = currentYear === thisYear ? new Date().getMonth() : -1;
  Charts.drawTrendBars($('yearMonthlyChart'), entries, highlightIndex);

  $('yearCategory').innerHTML = Object.entries(data.by_category).length
    ? Object.entries(data.by_category).map(([c, v]) => `
        <div class="breakdown-row"><span>${escapeHtml(c)}</span><span>${fmtMoney(v)}</span></div>`).join('')
    : '<div class="empty">No data yet.</div>';
}
$('yearPrev').addEventListener('click', () => { currentYear -= 1; loadYear(); });
$('yearNext').addEventListener('click', () => { currentYear += 1; loadYear(); });

// ---------- init ----------
window.startEditById = startEditById;
window.deleteExpense = deleteExpense;
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }
checkAuth().then((loggedIn) => { if (loggedIn) { loadDay(); loadMonth(); renderChips(); } });
