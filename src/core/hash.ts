export type HashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

export async function hashText(
  input: string,
  algorithm: HashAlgorithm = "SHA-256",
): Promise<string> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("Web Crypto subtle.digest is not available in this runtime");
  }

  const data = new TextEncoder().encode(input);
  const digest = await cryptoApi.digest(algorithm, data);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
}
