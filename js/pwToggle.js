/* Wires up every .pw-toggle button (each pointing at an input via
   data-target) to flip that input between password/text and swap its
   eye / eye-slash icon. Shared across login/signup/reset pages. */
document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.querySelector(".eye-open").style.display = showing ? "" : "none";
    btn.querySelector(".eye-closed").style.display = showing ? "none" : "";
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});
