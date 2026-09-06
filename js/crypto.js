/* Local password hashing using the browser's Web Crypto API (PBKDF2).
   This protects against someone casually opening the data store, not a
   real remote attacker -- there is no server to attack. Requires a
   secure context (https:// or localhost), same as the rest of the app. */

const PBKDF2_ITERATIONS = 150000;

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? b64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(16)).buffer;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial, 256);
  return { saltB64: bufToB64(salt), hashB64: bufToB64(bits) };
}

async function verifyPassword(password, saltB64, expectedHashB64) {
  const { hashB64 } = await hashPassword(password, saltB64);
  return hashB64 === expectedHashB64;
}

window.Crypto = { hashPassword, verifyPassword, bufToB64, b64ToBuf };
