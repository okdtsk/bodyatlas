function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(b64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importKey(secretB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(secretB64), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(
  plain: string,
  secretB64: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12) as Uint8Array<ArrayBuffer>);
  const key = await importKey(secretB64);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { ciphertext: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  secretB64: string,
): Promise<string> {
  const key = await importKey(secretB64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(iv) },
    key,
    b64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plain);
}
