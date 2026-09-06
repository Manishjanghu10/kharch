const $ = (id) => document.getElementById(id);

let editingId = null;
let dayExpensesById = {};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function currentMonthStr() { return todayStr().slice(0, 7); }
function fmtMoney(n) { return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fillSelect(sel, options) {
  sel.innerHTML = options.map((o) => `<option value="${o}">${o}</option>`).join('');
}

fillSelect($('fCategory'), Parser.CATEGORIES);
fillSelect($('fPaymentMode'), Parser.PAYMENT_MODES);

// ---------- auth bootstrap ----------
async function checkAuth() {
  const user = await DataStore.currentUser();
  if (!user) { window.location.href = 'login.html'; return; }
  $('userName').textContent = user.name;
}

$('logoutBtn').addEventListener('click', () => {
  DataStore.logout();
  window.location.href = 'login.html';
});

$('exportLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const data = await DataStore.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kharch-export-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

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

// ---------- parse & confirm ----------
function doParse() {
  const text = $('dictateText').value.trim();
  if (!text) { showToast('Say or type an expense first.'); return; }
  const data = Parser.parseExpenseText(text);
  $('fAmount').value = data.amount ?? '';
  $('fCategory').value = data.category || 'Other';
  $('fPaymentMode').value = data.payment_mode || 'Cash';
  $('fNote').value = '';
  $('fDate').value = editingId ? ($('fDate').value || todayStr()) : todayStr();
  $('confirmBlock').style.display = 'block';
  $('micHint').textContent = 'Check the details below, then save.';
}
$('parseBtn').addEventListener('click', doParse);
$('cancelBtn').addEventListener('click', resetForm);

function resetForm() {
  editingId = null;
  $('dictateText').value = '';
  $('confirmBlock').style.display = 'none';
  $('saveBtn').textContent = 'Save expense';
  $('micHint').textContent = 'Tap the mic and say it, or type it, then tap Parse.';
}

$('saveBtn').addEventListener('click', async () => {
  const amount = parseFloat($('fAmount').value);
  if (!amount || amount <= 0) { showToast('Enter a valid amount.'); return; }
  const body = {
    amount,
    category: $('fCategory').value,
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
  } catch (e) {
    showToast(e.message || 'Could not save expense.');
    return;
  }
  showToast(editingId ? 'Expense updated.' : 'Expense saved.');
  resetForm();
  loadDay();
  loadMonth();
});

function startEditById(id) { startEdit(dayExpensesById[id]); }
function startEdit(exp) {
  editingId = exp.id;
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

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  const ok = await DataStore.deleteExpense(id);
  if (!ok) { showToast('Could not delete.'); return; }
  loadDay();
  loadMonth();
}

// ---------- tabs ----------
$('tabDay').addEventListener('click', () => {
  $('tabDay').classList.add('active'); $('tabMonth').classList.remove('active');
  $('dayPanel').style.display = 'block'; $('monthPanel').style.display = 'none';
});
$('tabMonth').addEventListener('click', () => {
  $('tabMonth').classList.add('active'); $('tabDay').classList.remove('active');
  $('monthPanel').style.display = 'block'; $('dayPanel').style.display = 'none';
});

// ---------- day view ----------
$('dayPicker').value = todayStr();
async function loadDay() {
  const date = $('dayPicker').value || todayStr();
  const data = await DataStore.getDay(date);
  $('dayTotal').textContent = fmtMoney(data.total);
  const list = $('dayList');
  dayExpensesById = Object.fromEntries(data.expenses.map((e) => [e.id, e]));
  if (!data.expenses.length) {
    list.innerHTML = '<div class="empty">No expenses logged for this day.</div>';
    return;
  }
  list.innerHTML = data.expenses.map((e) => `
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
  `).join('');
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
$('monthPicker').value = currentMonthStr();
async function loadMonth() {
  const month = $('monthPicker').value || currentMonthStr();
  const data = await DataStore.getMonth(month);
  $('monthTotal').textContent = fmtMoney(data.total);

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

  $('monthCategory').innerHTML = Object.entries(data.by_category).length
    ? Object.entries(data.by_category).map(([c, v]) => `
        <div class="breakdown-row"><span>${escapeHtml(c)}</span><span>${fmtMoney(v)}</span></div>`).join('')
    : '<div class="empty">No data yet.</div>';

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

// ---------- init ----------
window.startEditById = startEditById;
window.deleteExpense = deleteExpense;
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }
checkAuth().then(() => { loadDay(); loadMonth(); });
