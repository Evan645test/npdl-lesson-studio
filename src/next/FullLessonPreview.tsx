import { useState, type ReactNode } from 'react';
import { activityPeriodLoadNotice } from './activityPeriodReminder';

// R31（2026-11-09 使用者決定）：完整教案預覽改為一般內文摘要（建議條列）＋每節有標籤的卡片，可全部展開／收合。
interface Lesson { id?: string; name?: string; task?: string; knowledgeUse?: string; evidence?: string; formative?: string; coreActivityId?: string }
const FIELDS = [['task', '學生任務'], ['knowledgeUse', '學科用途'], ['evidence', '學生產出'], ['formative', '形成性回饋']] as const;

// 把「建議重點調整：(1)…；(2)…；(3)…。其餘說明」拆成前言、條列與結語；沒有編號時整段原樣顯示。
export function splitSummary(text: string): { intro: string; items: string[]; outro: string } {
  const marker = /[（(]\s*\d+\s*[)）]\s*/g;
  const starts = [...text.matchAll(marker)];
  if (starts.length < 2) return { intro: text.trim(), items: [], outro: '' };
  const intro = text.slice(0, starts[0].index).trim().replace(/(?:建議)?(?:重點)?(?:調整|修改)(?:建議)?[:：]?$/u, '').trim();
  const items: string[] = [];
  let outro = '';
  starts.forEach((match, i) => {
    const from = match.index! + match[0].length, to = i + 1 < starts.length ? starts[i + 1].index! : text.length;
    let part = text.slice(from, to);
    if (i === starts.length - 1) {
      const end = part.search(/[。]/);
      if (end >= 0) { outro = part.slice(end + 1).trim(); part = part.slice(0, end + 1); }
    }
    items.push(part.trim().replace(/[；;，,]$/u, '。'));
  });
  return { intro, items, outro };
}

// 逐節卡片：完整教案預覽與正式專案「逐節課程」共用；extra 放在展開內容最後（如四階支持、修改按鈕）。
export function LessonCards({ lessons, coreNames = {}, title, extra }: {
  lessons: Lesson[]; coreNames?: Record<string, string>; title?: string; extra?: (index: number) => ReactNode;
}) {
  const [open, setOpen] = useState<boolean[]>(() => lessons.map((_, i) => i === 0));
  const shown = lessons.map((_, i) => open[i] ?? false);
  const allOpen = shown.every(Boolean);
  return <>
    <div className="sp-full-lessons-head">
      <h3>{title ?? `逐節教案（${lessons.length} 節）`}</h3>
      <button type="button" onClick={() => setOpen(lessons.map(() => !allOpen))}>{allOpen ? '全部收合' : '全部展開'}</button>
    </div>
    <ol className="sp-full-lessons">{lessons.map((lesson, i) => <li key={lesson.id ?? i} className="sp-full-lesson">
      <button type="button" className="sp-full-lesson-head" aria-expanded={shown[i]} onClick={() => setOpen(lessons.map((_, at) => at === i ? !shown[at] : shown[at]))}>
        <span className="sp-full-lesson-no">第 {i + 1} 節</span>
        <span className="sp-full-lesson-name">{lesson.name}</span>
        {lesson.coreActivityId && coreNames[lesson.coreActivityId] && <span className="sp-full-lesson-core">{coreNames[lesson.coreActivityId]}</span>}
      </button>
      {shown[i] && <div className="sp-full-lesson-open">
        <dl className="sp-full-lesson-body">{FIELDS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{lesson[key] || '（空白）'}</dd></div>)}</dl>
        {(() => { const notice = activityPeriodLoadNotice(lesson.task || ''); return notice ? <p className="notice" role="status">{notice}</p> : null; })()}
        {extra?.(i)}
      </div>}
    </li>)}</ol>
  </>;
}

export function FullLessonPreview({ summary, lessons, coreNames, onAccept }: {
  summary: string; lessons: Lesson[]; coreNames: Record<string, string>; onAccept: () => void;
}) {
  const { intro, items, outro } = splitSummary(summary);
  return <div className="sp-full-preview">
    <section className="sp-full-summary" aria-label="單元摘要">
      <h3>單元摘要</h3>
      {intro && <p>{intro}</p>}
      {items.length > 0 && <><h4>建議重點調整</h4><ol>{items.map((item, i) => <li key={i}>{item}</li>)}</ol></>}
      {outro && <p>{outro}</p>}
    </section>
    <LessonCards lessons={lessons} coreNames={coreNames} />
    <button type="button" className="primary" onClick={onAccept}>採用完整教案並建立正式專案</button>
  </div>;
}
