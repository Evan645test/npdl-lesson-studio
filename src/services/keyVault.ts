import type { AiProvider } from './AiSettings';

// R31（2026-11-09 使用者決定）：預設金鑰只在分頁記憶體。教師勾選「在這台電腦記住」才加密保存：
// 以瀏覽器產生、不可匯出的 AES-GCM 256 金鑰加密，密文與該金鑰存在本網址的 IndexedDB；取消勾選或清除金鑰即刪除。
// 不進工作區、草稿、備份、文件或診斷紀錄。限制：同一台電腦同一瀏覽器設定檔、在此網址執行的程式仍可解密使用。
const DB_NAME = 'npdl-next-key-vault-v1';
const STORE = 'vault';
const WRAP_ID = 'aes-gcm-key';
export const PROVIDERS: AiProvider[] = ['openai', 'gemini'];

type Sealed = { iv: Uint8Array; data: ArrayBuffer };
export interface VaultStore {
  get(id: string): Promise<unknown>;
  put(id: string, value: unknown): Promise<void>;
  delete(id: string): Promise<void>;
}

function idbStore(): VaultStore {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () => opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await db()).transaction(STORE, mode);
    const request = act(tx.objectStore(STORE));
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: id => run('readonly', s => s.get(id)),
    put: async (id, value) => { await run('readwrite', s => s.put(value, id)); },
    delete: async id => { await run('readwrite', s => s.delete(id)); },
  };
}

export function createKeyVault(store: VaultStore = idbStore(), subtle: SubtleCrypto = crypto.subtle) {
  async function wrapKey(create: boolean): Promise<CryptoKey | undefined> {
    const existing = await store.get(WRAP_ID);
    if (existing instanceof CryptoKey) return existing;
    if (!create) return undefined;
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await store.put(WRAP_ID, key);
    return key;
  }
  return {
    async remember(provider: AiProvider, apiKey: string): Promise<void> {
      if (!apiKey.trim()) { await this.forget(provider); return; }
      const key = (await wrapKey(true))!;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey));
      await store.put(provider, { iv, data } satisfies Sealed);
    },
    async forget(provider: AiProvider): Promise<void> {
      await store.delete(provider);
      const others = await Promise.all(PROVIDERS.filter(p => p !== provider).map(p => store.get(p)));
      if (others.every(x => x === undefined)) await store.delete(WRAP_ID);
    },
    // 解不開的紀錄（例如瀏覽器已換新金鑰）直接刪除，不中斷頁面。
    async load(): Promise<Partial<Record<AiProvider, string>>> {
      const key = await wrapKey(false);
      const out: Partial<Record<AiProvider, string>> = {};
      for (const provider of PROVIDERS) {
        const sealed = await store.get(provider) as Sealed | undefined;
        if (!sealed) continue;
        try {
          if (!key) throw Error('missing key');
          out[provider] = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data));
        } catch { await store.delete(provider); }
      }
      return out;
    },
  };
}
export type KeyVault = ReturnType<typeof createKeyVault>;

// R34（Codex 複審第 3 項）：保存與刪除依呼叫順序逐一執行，取消記住或清除會排在進行中的保存之後，不會被晚完成的保存寫回密文。
// R35：兩家供應商共用同一條佇列。兩家共用一把加密金鑰，分開排隊時，同時首次保存會各建一把而互相覆蓋，
// 刪除一家時也可能誤刪另一家正在使用的金鑰，重載後記住的金鑰遺失。
export function createVaultQueue(vault: Pick<KeyVault, 'remember' | 'forget'>) {
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (run: () => Promise<void>) => {
    const next = chain.catch(() => {}).then(run);
    chain = next.catch(() => {});
    return next;
  };
  return {
    remember: (provider: AiProvider, apiKey: string) => enqueue(() => vault.remember(provider, apiKey)),
    forget: (provider: AiProvider) => enqueue(() => vault.forget(provider)),
  };
}
