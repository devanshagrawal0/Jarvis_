// Synapse W4 — browser E2E identity via Web Crypto X25519. Mirrors server/coop-transport.js so the
// safety number the guest computes matches the one the host shows (fingerprint = SHA-256 of the DER
// SPKI key bytes, identical across node and the browser). Falls back gracefully where X25519 is
// unsupported — the session still works, just with the server-side fallback fingerprint.

export type SynIdentity = { keyPair: CryptoKeyPair; publicKeyPem: string; publicKeyDer: ArrayBuffer; fingerprint: string };

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function derToPem(der: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const wrapped = b64.match(/.{1,64}/g)?.join("\n") || b64;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

export function x25519Supported(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

// Generate a fresh X25519 identity. Returns null (not throw) where the browser lacks X25519.
export async function generateIdentity(): Promise<SynIdentity | null> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: "X25519" } as unknown as AlgorithmIdentifier, true, ["deriveBits"])) as CryptoKeyPair;
    const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
    const fingerprint = toHex(await crypto.subtle.digest("SHA-256", spki)).slice(0, 32);
    return { keyPair: kp, publicKeyPem: derToPem(spki, "PUBLIC KEY"), publicKeyDer: spki, fingerprint };
  } catch {
    return null;
  }
}

// Signal-style safety number from both fingerprints — order-independent, matches the server.
export async function safetyNumber(fpA: string, fpB: string): Promise<string> {
  const [a, b] = [String(fpA || ""), String(fpB || "")].sort();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${a}:${b}`)));
  let out = "";
  for (let i = 0; i < 12; i++) out += (digest[i] % 10).toString();
  return out.replace(/(\d{4})(?=\d)/g, "$1 ");
}

// X25519 ECDH (the ephemeral leg the RTC layer uses); returns the shared secret as hex.
export async function ecdh(selfPriv: CryptoKey, peerPubDer: ArrayBuffer): Promise<string> {
  const peer = await crypto.subtle.importKey("spki", peerPubDer, { name: "X25519" } as unknown as AlgorithmIdentifier, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "X25519", public: peer } as unknown as AlgorithmIdentifier, selfPriv, 256);
  return toHex(bits);
}
