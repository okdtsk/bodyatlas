import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';

// Fixed 32-byte base64 test secret: btoa of 32 'a' chars
const TEST_SECRET = btoa('a'.repeat(32));

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext string', async () => {
    const plain = 'sk-ant-api-key-test-value';
    const { ciphertext, iv } = await encryptSecret(plain, TEST_SECRET);
    const decrypted = await decryptSecret(ciphertext, iv, TEST_SECRET);
    expect(decrypted).toBe(plain);
  });

  it('round-trips a unicode string (Japanese)', async () => {
    const plain = 'テスト用キー・秘密';
    const { ciphertext, iv } = await encryptSecret(plain, TEST_SECRET);
    const decrypted = await decryptSecret(ciphertext, iv, TEST_SECRET);
    expect(decrypted).toBe(plain);
  });

  it('generates distinct IVs for each encryption call', async () => {
    const plain = 'same-plaintext';
    const result1 = await encryptSecret(plain, TEST_SECRET);
    const result2 = await encryptSecret(plain, TEST_SECRET);
    expect(result1.iv).not.toBe(result2.iv);
    // ciphertexts should also differ (different IV → different ciphertext)
    expect(result1.ciphertext).not.toBe(result2.ciphertext);
  });

  it('throws when ciphertext is tampered', async () => {
    const plain = 'sk-ant-original';
    const { ciphertext: _ct, iv } = await encryptSecret(plain, TEST_SECRET);
    // Corrupt the ciphertext by flipping some bytes
    const decoded = atob(_ct);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    bytes[1] = (bytes[1] ?? 0) ^ 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptSecret(tampered, iv, TEST_SECRET)).rejects.toThrow();
  });

  it('throws when decrypting with the wrong key', async () => {
    const plain = 'sk-ant-secret-value';
    const { ciphertext, iv } = await encryptSecret(plain, TEST_SECRET);
    const wrongSecret = btoa('b'.repeat(32));
    await expect(decryptSecret(ciphertext, iv, wrongSecret)).rejects.toThrow();
  });
});
