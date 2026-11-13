import { expect, it } from 'vitest';
import { createKeyVault, type VaultStore } from './keyVault';

function memory() {
  const rows = new Map<string, unknown>();
  const store: VaultStore = { get: async id => rows.get(id), put: async (id, v) => { rows.set(id, v); }, delete: async id => { rows.delete(id); } };
  return { rows, store };
}

it('R31 勾選才保存：密文不含明文金鑰，加密用金鑰不可匯出，重新載入可解回', async () => {
  const { rows, store } = memory();
  const vault = createKeyVault(store);
  await vault.remember('openai', 'sk-test-ABC123');
  const sealed = rows.get('openai') as { data: ArrayBuffer };
  expect(new TextDecoder().decode(sealed.data)).not.toContain('sk-test-ABC123');
  const wrap = rows.get('aes-gcm-key') as CryptoKey;
  expect(wrap.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', wrap)).rejects.toThrow();
  expect(await createKeyVault(store).load()).toEqual({ openai: 'sk-test-ABC123' });
});

it('R31 取消勾選或清空即刪除；兩家都刪除後連加密金鑰一起刪', async () => {
  const { rows, store } = memory();
  const vault = createKeyVault(store);
  await vault.remember('openai', 'a-key');
  await vault.remember('gemini', 'g-key');
  await vault.forget('openai');
  expect(await vault.load()).toEqual({ gemini: 'g-key' });
  expect(rows.has('aes-gcm-key')).toBe(true);
  await vault.remember('gemini', '   ');
  expect([...rows.keys()]).toEqual([]);
  expect(await vault.load()).toEqual({});
});

it('R31 解不開的密文直接刪除，不中斷', async () => {
  const { rows, store } = memory();
  const vault = createKeyVault(store);
  await vault.remember('openai', 'a-key');
  rows.set('aes-gcm-key', await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  expect(await vault.load()).toEqual({});
  expect(rows.has('openai')).toBe(false);
});

// R35：兩家供應商同時保存或一存一刪，都不可遺失另一家記住的金鑰。
import { describe } from 'vitest';
import { createKeyVault as createVaultR35, createVaultQueue as createQueueR35 } from './keyVault';
describe('R35 金鑰佇列跨供應商', () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 1));
  const slowStore = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => { await tick(); return m.get(k); }, put: async (k: string, v: unknown) => { await tick(); m.set(k, v); }, delete: async (k: string) => { await tick(); m.delete(k); } }; };
  it('首次同時記住兩家，重載後兩家都在', async () => {
    const vault = createVaultR35(slowStore()), queue = createQueueR35(vault);
    await Promise.all([queue.remember('openai', 'sk-aaa'), queue.remember('gemini', 'g-bbb')]);
    expect(await vault.load()).toEqual({ openai: 'sk-aaa', gemini: 'g-bbb' });
  });
  it('取消記住一家時另一家正在保存，另一家仍在', async () => {
    const vault = createVaultR35(slowStore()), queue = createQueueR35(vault);
    await queue.remember('openai', 'sk-aaa');
    await Promise.all([queue.forget('openai'), queue.remember('gemini', 'g-bbb')]);
    expect(await vault.load()).toEqual({ gemini: 'g-bbb' });
  });
});
