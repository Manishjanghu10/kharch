/* Shared 4-digit PIN keypad UI, used by both the login quick-unlock
   screen and the in-app "set a PIN" settings screen. */
function buildPinPad(keypadEl, dotsEl, digitCount, onComplete) {
  let digits = [];

  function render() {
    dotsEl.innerHTML = Array.from({ length: digitCount }, (_, i) =>
      `<div class="pin-dot ${i < digits.length ? "filled" : ""}"></div>`).join("");
  }

  function press(d) {
    if (digits.length >= digitCount) return;
    digits.push(d);
    render();
    if (digits.length === digitCount) {
      const pin = digits.join("");
      setTimeout(() => { digits = []; render(); onComplete(pin); }, 120);
    }
  }

  function backspace() { digits.pop(); render(); }
  function reset() { digits = []; render(); }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  keypadEl.innerHTML = keys.map((k) => {
    if (k === "") return '<div class="pin-key ghost"></div>';
    return `<button type="button" class="pin-key" data-key="${k}">${k}</button>`;
  }).join("");
  keypadEl.querySelectorAll(".pin-key[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.key;
      if (k === "⌫") backspace(); else press(k);
    });
  });

  render();
  return { reset };
}

window.PinPad = { buildPinPad };
