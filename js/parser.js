/* Turns a free-form sentence (typed or dictated) like
   "500 rupees on groceries by card" into a structured guess:
   {amount, category, payment_mode}. Always shown to the user for
   confirmation/edit before saving -- this is a best-effort first pass,
   not a source of truth. Kept dependency-free so it can run purely
   client-side. */

const CATEGORY_KEYWORDS = [
  ["Bills & Utilities", ["electricity bill", "water bill", "gas bill", "mobile bill",
                          "phone bill", "broadband", "wifi bill", "internet bill",
                          "recharge", "rent", "maintenance", "emi", "insurance", "utility bill"]],
  ["Groceries", ["grocery", "groceries", "vegetables", "veggies", "sabzi", "kirana",
                 "bigbasket", "blinkit", "zepto", "dmart", "milk", "provisions"]],
  ["Food & Dining", ["swiggy", "zomato", "restaurant", "lunch", "dinner", "breakfast",
                      "hotel", "dhaba", "cafe", "coffee", "tea", "snacks", "food", "eating out"]],
  ["Transport", ["uber", "ola", "cab", "taxi", "auto", "rickshaw", "petrol", "diesel",
                 "fuel", "metro", "bus fare", "train", "parking", "toll", "fastag"]],
  ["Shopping", ["amazon", "flipkart", "myntra", "shopping", "clothes", "shoes", "clothing"]],
  ["Entertainment", ["movie", "netflix", "prime video", "hotstar", "cinema", "subscription",
                      "game", "spotify", "outing"]],
  ["Medical", ["medicine", "medicines", "doctor", "hospital", "pharmacy", "medical", "clinic"]],
  ["Personal Care", ["salon", "haircut", "spa", "parlour", "gym"]],
  ["Travel", ["flight", "hotel booking", "trip", "vacation", "holiday"]],
  ["Education", ["fees", "tuition", "course", "book", "books", "school", "college"]],
];

const PAYMENT_KEYWORDS = [
  ["UPI", ["upi", "gpay", "google pay", "phonepe", "phone pe", "paytm", "bhim"]],
  ["Credit Card", ["credit card", "cc "]],
  ["Debit Card", ["debit card"]],
  ["Net Banking", ["netbanking", "net banking", "neft", "imps", "bank transfer"]],
  ["Card", ["card"]],
  ["Cash", ["cash"]],
];

const CATEGORIES = CATEGORY_KEYWORDS.map(([c]) => c).concat(["Other"]);
const PAYMENT_MODES = ["UPI", "Credit Card", "Debit Card", "Net Banking", "Card", "Cash"];

// ---------- income ----------

const INCOME_DETECT_KEYWORDS = [
  "received", "credited", "salary", "income", "earned", "refund", "cashback",
  "reimbursement", "reimbursed", "payment received", "got paid", "bonus",
  "interest received", "dividend", "sold",
];

const INCOME_SOURCE_KEYWORDS = [
  ["Salary", ["salary", "paycheck", "payroll"]],
  ["Freelance/Business", ["freelance", "client payment", "business", "invoice", "project payment", "got paid"]],
  ["Refund/Cashback", ["refund", "cashback", "reimbursement", "reimbursed"]],
  ["Interest/Dividend", ["interest", "dividend"]],
  ["Rental", ["rent received", "rental income"]],
  ["Sale", ["sold", "sale of"]],
  ["Gift", ["gift", "gifted"]],
];

const INCOME_SOURCES = INCOME_SOURCE_KEYWORDS.map(([s]) => s).concat(["Other"]);

function detectIncome(textLower) {
  return INCOME_DETECT_KEYWORDS.some((k) => textLower.includes(k));
}

function extractIncomeSource(textLower) {
  for (const [source, keywords] of INCOME_SOURCE_KEYWORDS) {
    for (const kw of keywords) {
      if (textLower.includes(kw)) return source;
    }
  }
  return "Other";
}

function extractAmount(textLower) {
  const match = textLower.match(/(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!match) return null;
  const val = parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(val) ? val : null;
}

function extractCategory(textLower) {
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (textLower.includes(kw)) return category;
    }
  }
  return "Other";
}

function extractPaymentMode(textLower) {
  for (const [mode, keywords] of PAYMENT_KEYWORDS) {
    for (const kw of keywords) {
      if (textLower.includes(kw)) return mode;
    }
  }
  return "Cash";
}

function parseExpenseText(text) {
  const trimmed = (text || "").trim();
  const lower = trimmed.toLowerCase();
  return {
    amount: extractAmount(lower),
    category: extractCategory(lower),
    payment_mode: extractPaymentMode(lower),
    raw_text: trimmed,
  };
}

// ---------- relative dates ("yesterday", "day before yesterday") ----------

function extractDateOffset(textLower) {
  if (/\bday before yesterday\b/.test(textLower)) return -2;
  if (/\byesterday\b/.test(textLower)) return -1;
  if (/\btoday\b/.test(textLower)) return 0;
  return null;
}

function offsetDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parses either an expense or an income entry from one sentence. Type is
// auto-detected from income keywords unless forcedType overrides it (used
// when the user has manually flipped the Expense/Income toggle).
function parseEntryText(text, forcedType) {
  const trimmed = (text || "").trim();
  const lower = trimmed.toLowerCase();
  const type = forcedType || (detectIncome(lower) ? "income" : "expense");
  const amount = extractAmount(lower);
  const payment_mode = extractPaymentMode(lower);
  const offset = extractDateOffset(lower);
  const date_offset = offset !== null ? offset : 0;
  const spent_date_guess = offsetDateStr(date_offset);

  if (type === "income") {
    return { type, amount, source: extractIncomeSource(lower), payment_mode, raw_text: trimmed, date_offset, spent_date_guess };
  }
  return { type, amount, category: extractCategory(lower), payment_mode, raw_text: trimmed, date_offset, spent_date_guess };
}

// ---------- multiple items in one sentence ("500 on lunch and 200 on auto") ----------

function splitSegments(text) {
  return text.split(/\s*(?:,|;|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
}

function parseExpenseTextMulti(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const globalOffset = extractDateOffset(lower);

  const withDates = (parsed, segmentLower) => {
    const localOffset = extractDateOffset(segmentLower);
    const offset = localOffset !== null ? localOffset : (globalOffset !== null ? globalOffset : 0);
    return { ...parsed, date_offset: offset, spent_date_guess: offsetDateStr(offset) };
  };

  const segments = splitSegments(trimmed);
  const candidates = segments.map((seg) => withDates(parseExpenseText(seg), seg.toLowerCase()));
  const withAmount = candidates.filter((c) => c.amount !== null);
  if (withAmount.length >= 2) return withAmount;

  // Not really multiple items (or only one had a usable amount) -- treat
  // the whole thing as a single expense instead of over-splitting on a
  // stray "and".
  return [withDates(parseExpenseText(trimmed), lower)];
}

// ---------- learning signature: groups "zomato 500 by upi" and "zomato
// 250 via card" under the same key so a corrected category can be
// remembered regardless of amount/payment mode. ----------

const SIGNATURE_STOPWORDS = new Set([
  "rupees", "rupee", "rs", "inr", "paisa", "on", "for", "by", "using", "via",
  "through", "paid", "spent", "spend", "cash", "card", "credit", "debit",
  "upi", "netbanking", "net", "banking", "and", "a", "an", "the", "to",
  "of", "with", "today", "yesterday", "before",
]);

function computeSignature(text) {
  const words = (text || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const sig = words.filter((w) => !SIGNATURE_STOPWORDS.has(w)).sort().join(" ");
  return sig || null;
}

window.Parser = {
  parseExpenseText, parseExpenseTextMulti, parseEntryText, computeSignature, offsetDateStr,
  detectIncome, CATEGORIES, PAYMENT_MODES, INCOME_SOURCES,
};
