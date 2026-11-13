import { useMemo, useState } from 'react';
import { STAGES, type CourseInput } from '../domain/types';
import { addAssumption, addCurriculumId, addIndicatorId, removeAssumption, removeCurriculumId, removeIndicatorId } from './courseDraft';
import { curriculum, curriculumById, curriculumKind, indicatorById, indicators } from './labels';
import { FieldAiAssist } from '../next/FieldAiAssist';

export function CourseStart({ input, onInput, onError, onShowGoals }: {
  input: CourseInput; onInput: (next: CourseInput) => void; onError: (message: string) => void; onShowGoals: () => void;
}) {
  const [query, setQuery] = useState('');
  const [indicatorId, setIndicatorId] = useState('');
  const [assumption, setAssumption] = useState('');
  const results = useMemo(() => {
    const keyword = query.trim();
    if (!keyword) return [];
    return curriculum.filter(item => !input.curriculumIds.includes(item.id) && [item.code, item.subject, item.domain, item.text, curriculumKind(item.kind)].some(value => value.includes(keyword))).slice(0, 8);
  }, [input.curriculumIds, query]);
  const available = indicators.entries.filter(item => !input.indicatorIds.includes(item.id));
  function change(next: CourseInput) { onInput(next); }
  function guard(action: () => CourseInput) {
    try { change(action()); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }
  return <>
    <div className="hero"><div className="eyebrow">01・由學科問題開始</div><h1>把「學會什麼」<br/>接到「看得見什麼」。</h1><p>先改學科、課綱、學生起點和 1 到 2 項子指標。這些都先停在輸入草稿；現有設計與題組不會跟著改寫。</p></div>
    <section className="card draft-block"><div className="eyebrow">輸入草稿・可修改</div><h2>學科、年級與學生起點</h2>
      <div className="fields">
        <label>學科<input aria-label="學科" maxLength={160} value={input.subject} onChange={event => { if (event.target.value.trim()) change({ ...input, subject: event.target.value }); }} /></label>
        <label>年級<input aria-label="年級" maxLength={160} value={input.grade} onChange={event => { if (event.target.value.trim()) change({ ...input, grade: event.target.value }); }} /></label>
        <FieldAiAssist label="單元名稱" value={input.title} maxLength={160} context={{ subject: input.subject, grade: input.grade, topic: input.topic }} onApply={text => change({ ...input, title: text })}><input aria-label="單元名稱" maxLength={160} value={input.title} onChange={event => { if (event.target.value.trim()) change({ ...input, title: event.target.value }); }} /></FieldAiAssist>
        <label>節數<input aria-label="節數" type="number" min="1" max="60" value={input.periods} onChange={event => { const periods = Number(event.target.value); if (Number.isInteger(periods) && periods >= 1 && periods <= 60) change({ ...input, periods }); }} /></label>
      </div>
      <FieldAiAssist label="學科問題" value={input.topic} context={{ subject: input.subject, grade: input.grade, title: input.title }} onApply={text => change({ ...input, topic: text })}><textarea aria-label="學科問題" maxLength={20000} value={input.topic} onChange={event => change({ ...input, topic: event.target.value })} /></FieldAiAssist>
      <label>已知學生起點（可留空）<textarea aria-label="學生起點" maxLength={20000} value={input.startingPoint.text} placeholder="沒有資料就留空。空白會標成起點未知，不會被當成能力較低。" onChange={event => change({ ...input, startingPoint: { ...input.startingPoint, text: event.target.value, status: event.target.value.trim() ? 'provided' : 'unknown' } })} /></label>
      <p className="note">目前：{input.startingPoint.status === 'unknown' ? '學生起點未知。未知不是最低階，也不代表全班起點相同。' : '教師已提供起點，尚未核對，也不能据此重寫設計。'}</p>
      <h3>先備假設</h3>
      <ul className="assumption-list">{input.startingPoint.assumptions.map((item, index) => <li key={`${index}-${item}`}><span>{item}</span><button type="button" onClick={() => guard(() => ({ ...input, startingPoint: { ...input.startingPoint, assumptions: removeAssumption(input.startingPoint.assumptions, index) } }))}>移除假設 {index + 1}</button></li>)}</ul>
      <div className="inline-action"><label>新增起點假設<input aria-label="新增起點假設" maxLength={20000} value={assumption} onChange={event => setAssumption(event.target.value)} /></label><button type="button" onClick={() => guard(() => { const assumptions = addAssumption(input.startingPoint.assumptions, assumption); setAssumption(''); return { ...input, startingPoint: { ...input.startingPoint, assumptions } }; })}>加入假設</button></div>
    </section>
    <section className="card"><h2>課綱草稿</h2><p className="note">固定副本有高中課綱 1155 條。選進草稿最多 12 條，不會自動改寫設計快照。課綱和子指標的連結是這份單元的設計關係，不是官方一對一對照。</p>
      {input.curriculumIds.map(id => { const item = curriculumById(id); return <div className="reference" key={id}>{item ? <><strong>{item.code}・{item.subject}・{curriculumKind(item.kind)}</strong><p>{item.text}</p><small>{item.sourceDocumentTitle}／{item.sourceVersion}；本機摘錄，尚未重新逐字核對官方原文。</small></> : <p>找不到課綱 {id}</p>}<button type="button" onClick={() => change({ ...input, curriculumIds: removeCurriculumId(input.curriculumIds, id) })}>移除課綱 {item?.code ?? id}</button></div>; })}
      <label>搜尋課綱<input aria-label="搜尋課綱" value={query} placeholder="輸入代碼、科目或條文，例如 CJe-Ⅴa-1" onChange={event => setQuery(event.target.value)} /></label>
      {query.trim() && results.length === 0 && <p className="note">沒有可加入的相符課綱。已在草稿中的條目不會重複出現。</p>}
      <div className="results">{results.map(item => <button type="button" key={item.id} onClick={() => guard(() => { const curriculumIds = addCurriculumId(input.curriculumIds, item.id); setQuery(''); return { ...input, curriculumIds }; })}>加入課綱 {item.code}<small>{item.subject}・{curriculumKind(item.kind)}・{item.text}</small></button>)}</div>
    </section>
    <section className="card"><h2>選擇並對照 1–2 項子指標</h2><p>一個單元只聚焦一到兩項。請對照工具四階敘述後決定是否留在草稿；留在草稿不會進入目前的規準、活動或題組。</p><p className="note">{indicators.source.notice} 工具四階是證據有限、萌芽、發展、精熟，不能換成書中學生五階或設計品質四階。</p>
      {input.indicatorIds.map(id => { const item = indicatorById(id); return <article className="reference" key={id}><h3>{item ? `${item.dimension}／${item.name}` : id}</h3>{item && <ol className="stage-list">{item.stages.map((stage, index) => <li key={stage}><span className="tag">{STAGES[index]}</span>{stage}</li>)}</ol>}<button type="button" disabled={input.indicatorIds.length <= 1} onClick={() => guard(() => ({ ...input, indicatorIds: removeIndicatorId(input.indicatorIds, id) }))}>從草稿移除 {item?.name ?? id}</button>{input.indicatorIds.length <= 1 && <p className="note">至少保留 1 項子指標。</p>}</article>; })}
      <label>加入草稿的子指標<select aria-label="加入草稿的子指標" value={indicatorId} disabled={input.indicatorIds.length >= 2 || available.length === 0} onChange={event => setIndicatorId(event.target.value)}><option value="">選擇尚未加入的子指標</option>{available.map(item => <option key={item.id} value={item.id}>{item.dimension}／{item.name}</option>)}</select></label>
      <button type="button" disabled={input.indicatorIds.length >= 2} onClick={() => guard(() => { const indicatorIds = addIndicatorId(input.indicatorIds, indicatorId); setIndicatorId(''); return { ...input, indicatorIds }; })}>把選取的子指標加入草稿</button>
      {input.indicatorIds.length >= 2 && <p className="note">草稿已有 2 項，不能再加。先移除一項才能更換。</p>}
      <button type="button" className="primary" onClick={onShowGoals}>接著核對成功表現</button>
    </section>
    <section className="card"><h2>教師註記（另存於草稿）</h2><label>教師自己的來源與核對註記<textarea aria-label="教師來源註記" maxLength={60000} value={input.teacherNotes ?? ''} onChange={event => change({ ...input, teacherNotes: event.target.value })} /></label><p className="note">註記與原始來源分開，原文不被改寫。AI 不會自動收到這段註記；需要時自行整理去識別摘錄。</p></section>
    <section className="card source-block"><div className="eyebrow">原始來源・唯讀</div><h2>原始來源</h2><p>{input.originalSource.text}</p><p className="note">{input.originalSource.kind === 'manual-example' ? '這是人工範例原文。' : '這是教師提供的原文。'}修改學科、課綱、起點、子指標，或另存目標與活動草稿，都不會改寫這段文字。</p></section>
  </>;
}
