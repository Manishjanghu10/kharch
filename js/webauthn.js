/* Thin wrapper around the WebAuthn platform authenticator (Face ID /
   Touch ID / Windows Hello / Android fingerprint) for quick-unlock.
   There is no server here to verify a signed assertion against, so this
   is a *local convenience* gate, not remote-grade auth: success just
   means "this device's own OS authenticator approved", trusted the same
   way an OS lock screen is trusted. Real security still rests on the
   account password / recovery key. */

async function isAvailable() {
  return !!(window.PublicKeyCredential &&
    navigator.credentials &&
    (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)));
}

async function register(email, name) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Kharch" },
      user: { id: userId, name: email, displayName: name || email },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("Could not register biometric unlock.");
  return Crypto.bufToB64(cred.rawId);
}

async function authenticate(credentialIdB64) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: Crypto.b64ToBuf(credentialIdB64), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!cred;
}

window.Webauthn = { isAvailable, register, authenticate };
