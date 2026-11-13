import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createKeyVault, createVaultQueue, type KeyVault } from './keyVault';

export type AiProvider = 'openai' | 'gemini';

interface AiSettingsState {
  provider: AiProvider;
  setProvider: (provider: AiProvider) => void;
  key: string;
  model: string;
  setKey: (key: string) => void;
  setModel: (model: string) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  // R12-r11：兩家各自的金鑰與模型，讓設定畫面同時顯示「已填／未填」。
  keyOf: (provider: AiProvider) => string;
  modelOf: (provider: AiProvider) => string;
  setKeyFor: (provider: AiProvider, key: string) => void;
  setModelFor: (provider: AiProvider, model: string) => void;
  // R31：教師勾選才加密保存在這台電腦；預設只在記憶體。
  rememberedOf: (provider: AiProvider) => boolean;
  setRemember: (provider: AiProvider, remember: boolean) => void;
  vaultProblem: string;
}

const Context = createContext<AiSettingsState | null>(null);
export function isValidModelId(model: string, provider: AiProvider = 'openai'): boolean {
  if (provider === 'gemini') return /^gemini-[a-zA-Z0-9][a-zA-Z0-9._-]{0,152}$/.test(model);
  return !model.startsWith('gemini-') && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(model);
}

export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1');
  const [geminiModel, setGeminiModel] = useState('gemini-3.8-flash');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remembered, setRemembered] = useState<Record<AiProvider, boolean>>({ openai: false, gemini: false });
  const [vaultProblem, setVaultProblem] = useState('');
  const vault = useRef<KeyVault | null>(null);
  const queue = useRef<ReturnType<typeof createVaultQueue> | null>(null);
  if (!vault.current && typeof indexedDB !== 'undefined' && globalThis.crypto?.subtle) {
    try { vault.current = createKeyVault(); queue.current = createVaultQueue(vault.current); } catch { vault.current = null; queue.current = null; }
  }
  const keys = { openai: openaiKey, gemini: geminiKey };
  useEffect(() => {
    let live = true;
    vault.current?.load().then(saved => {
      if (!live) return;
      for (const which of ['openai', 'gemini'] as const) {
        const key = saved[which];
        if (!key) continue;
        (which === 'gemini' ? setGeminiKey : setOpenaiKey)(current => current || key);
        setRemembered(current => ({ ...current, [which]: true }));
      }
    }).catch(() => { if (live) setVaultProblem('無法讀取這台電腦記住的金鑰；請重新貼上。'); });
    return () => { live = false; };
  }, []);
  // 勾選記住時，金鑰變更後稍等再加密保存；清空金鑰即刪除。
  useEffect(() => {
    const timers = (['openai', 'gemini'] as const).filter(which => remembered[which]).map(which => setTimeout(() => {
      queue.current?.remember(which, keys[which]).then(() => setVaultProblem('')).catch(() => setVaultProblem('無法在這台電腦保存金鑰；本頁仍可使用。'));
    }, 400));
    return () => timers.forEach(clearTimeout);
  }, [openaiKey, geminiKey, remembered.openai, remembered.gemini]);
  const value = useMemo(() => ({
    provider, setProvider,
    key: provider === 'gemini' ? geminiKey : openaiKey,
    model: provider === 'gemini' ? geminiModel : openaiModel,
    setKey: (key: string) => provider === 'gemini' ? setGeminiKey(key) : setOpenaiKey(key),
    setModel: (model: string) => provider === 'gemini' ? setGeminiModel(model) : setOpenaiModel(model),
    settingsOpen, setSettingsOpen,
    keyOf: (which: AiProvider) => which === 'gemini' ? geminiKey : openaiKey,
    modelOf: (which: AiProvider) => which === 'gemini' ? geminiModel : openaiModel,
    setKeyFor: (which: AiProvider, key: string) => which === 'gemini' ? setGeminiKey(key) : setOpenaiKey(key),
    setModelFor: (which: AiProvider, model: string) => which === 'gemini' ? setGeminiModel(model) : setOpenaiModel(model),
    rememberedOf: (which: AiProvider) => remembered[which],
    setRemember: (which: AiProvider, remember: boolean) => {
      if (remember && !vault.current) { setVaultProblem('這個瀏覽器無法加密保存金鑰；本頁仍可使用。'); return; }
      setRemembered(current => ({ ...current, [which]: remember }));
      if (!remember) queue.current?.forget(which).catch(() => setVaultProblem('刪除這台電腦記住的金鑰失敗；可清除瀏覽器網站資料。'));
    },
    vaultProblem,
  }), [provider, openaiKey, geminiKey, openaiModel, geminiModel, settingsOpen, remembered, vaultProblem]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAiSettings(): AiSettingsState {
  const value = useContext(Context);
  if (!value) throw new Error('AI 設定尚未初始化。');
  return value;
}
