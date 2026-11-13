import { isValidModelId, useAiSettings, type AiProvider } from '../services/AiSettings';

const OPENAI_MODELS = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol・較深入' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna・較快速' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra・均衡' },
  { id: 'gpt-4.1', label: 'GPT-4.1・原預設模型' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini・較輕量' },
] as const;

// R12-r11：兩家並列，不標「建議」；Gemini 依 2026-11 試跑結果附提醒。
const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite・較輕量' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro・預覽版' },
] as const;
const GEMINI_NOTE = '2026-11 試跑：Gemini 較常需要格式修復，題目裡的數字與法規請特別核對。';

export const providerName = (provider: AiProvider) => provider === 'gemini' ? 'Gemini' : 'OpenAI';
export function modelLabel(provider: AiProvider, model: string): string {
  const row = (provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS).find(option => option.id === model);
  return row ? row.label.split('・')[0] : model || '未選模型';
}
// 例：「OpenAI・GPT-5.6 Terra」，畫面上說明這次用哪家哪個模型。
export function usingLabel(provider: AiProvider, model: string): string { return `${providerName(provider)}・${modelLabel(provider, model)}`; }

function ProviderCard({ which }: { which: AiProvider }) {
  const { provider, setProvider, keyOf, modelOf, setKeyFor, setModelFor, rememberedOf, setRemember } = useAiSettings();
  const name = providerName(which), key = keyOf(which), model = modelOf(which), active = provider === which;
  const models = which === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS;
  const custom = !models.some(option => option.id === model);
  return <div className={`ai-provider-card ${active ? 'is-active' : ''}`}>
    <div className="ai-provider-top"><strong>{which === 'gemini' ? 'Google Gemini' : 'OpenAI'}</strong>{active ? <span className="ai-badge active">使用中</span> : <button type="button" onClick={() => setProvider(which)}>改用這家</button>}</div>
    <label>{name} API key<input id={active ? 'ai-key-input' : undefined} type="password" aria-label={which === 'gemini' ? 'Gemini API key' : '發想 API key'} autoComplete="off" spellCheck={false} value={key} onChange={event => setKeyFor(which, event.target.value)} placeholder={`貼上你的 ${name} API key`} /></label>
    <span className={`ai-key-state ${key.trim() ? 'ok' : 'missing'}`}>{key.trim() ? rememberedOf(which) ? '✓ 已填入，這台電腦已加密記住' : '✓ 已填入，本頁有效' : '尚未填入'}</span>
    <label className="consent-check"><input type="checkbox" checked={rememberedOf(which)} onChange={event => setRemember(which, event.target.checked)} />在這台電腦記住 {name} 金鑰（加密保存；共用電腦請勿勾選）</label>
    <label>模型<select aria-label={active ? '發想使用模型' : `${name} 使用模型`} value={custom ? '__custom__' : model} onChange={event => setModelFor(which, event.target.value === '__custom__' ? '' : event.target.value)}>{models.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="__custom__">自訂 {name} 模型 ID</option></select></label>
    {custom && <label className="ai-custom-model">自訂模型 ID<input aria-label={active ? '發想模型 ID' : `${name} 模型 ID`} value={model} maxLength={160} onChange={event => setModelFor(which, event.target.value)} placeholder={`輸入可用的 ${name} 模型 ID`} /></label>}
    {which === 'gemini' && <p className="ai-provider-note">{GEMINI_NOTE}</p>}
    {key && <button type="button" className="ai-clear" onClick={() => { setKeyFor(which, ''); if (rememberedOf(which)) setRemember(which, false); }}>清除 {name} 金鑰{rememberedOf(which) ? '並取消記住' : ''}</button>}
  </div>;
}

export function AiSetupPanel() {
  const { provider, setProvider, key, model, keyOf, settingsOpen, setSettingsOpen, vaultProblem } = useAiSettings();
  const ready = Boolean(key.trim()), validModel = isValidModelId(model, provider);
  const chip = (which: AiProvider) => <span className={`ai-badge ${keyOf(which).trim() ? 'ok' : 'missing'}`}>{providerName(which)} 金鑰{keyOf(which).trim() ? '已填' : '未填'}</span>;
  const problem = !ready ? `使用中的 ${providerName(provider)} 還沒有金鑰。` : !validModel ? `請為 ${providerName(provider)} 選擇有效模型。` : '';

  return <section id="ai-setup" className={`ai-setup ${settingsOpen ? 'is-open' : ''}`} aria-label="AI 設定">
    <div className="ai-setup-heading">
      <div><span className="eyebrow">AI 設定</span><p className="ai-using">本次使用：{usingLabel(provider, model)}</p><div className="ai-badges">{chip('openai')}{chip('gemini')}</div></div>
      <button type="button" aria-expanded={settingsOpen} aria-controls="ai-setup-fields" onClick={() => setSettingsOpen(!settingsOpen)}>{settingsOpen ? '收起設定' : '更換供應商或金鑰'}</button>
    </div>
    {settingsOpen && <div id="ai-setup-fields">
      <label className="ai-provider-select">使用的供應商<select aria-label="AI 供應商" value={provider} onChange={event => setProvider(event.target.value as AiProvider)}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></label>
      <div className="ai-setup-fields"><ProviderCard which="openai" /><ProviderCard which="gemini" /></div>
      <div className="ai-setup-foot">{vaultProblem && <p className="notice" role="status">{vaultProblem}</p>}<p>金鑰預設只存在這個分頁的記憶體，重新整理後要重填；勾選「在這台電腦記住」才以瀏覽器產生、不可匯出的金鑰加密保存在本機，取消勾選或清除即刪除。同一台電腦、同一瀏覽器設定檔的人仍可使用已記住的金鑰。金鑰都不進草稿、備份或文件。模型需由你的帳戶開通。備課流程第一次送出時預覽資料並同意一次；格式修復、附上的教案或舊前測有變更、換模型時會再問。</p><div className="actions"><button type="button" className="primary" onClick={() => { if (!problem) setSettingsOpen(false); }} aria-describedby={problem ? 'ai-setup-problem' : undefined}>完成設定並收起</button>{problem && <span id="ai-setup-problem" className="ai-setup-problem" role="alert">{problem}</span>}</div></div>
    </div>}
  </section>;
}
