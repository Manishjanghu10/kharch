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

window.Parser = { parseExpenseText, CATEGORIES, PAYMENT_MODES };
