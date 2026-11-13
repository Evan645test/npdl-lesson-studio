import type { AssessmentVersion, CourseInput, DesignVersion, Project } from '../domain/types';
import { courseDraftGap } from './courseDraft';
import { snapshotLines } from './labels';

const steps = [
  { tab: '課程與起點', label: '學科、課綱與起點' },
  { tab: '課程與起點', label: '核對 1–2 項子指標' },
  { tab: '目標與規準', label: '目標與成功表現' },
  { tab: '目標與規準', label: '規準與藍圖' },
  { tab: '活動與鷹架', label: '活動與撤去提示' },
] as const;

function mark(done: boolean, waiting: string): string {
  return done ? '資料已有時間標記' : waiting;
}

export function CourseStatus({ project, design, input, pre, post, tab, onTab }: {
  project: Project; design: DesignVersion; input: CourseInput; pre: AssessmentVersion | undefined; post: AssessmentVersion | undefined;
  tab: string; onTab: (tab: typeof steps[number]['tab']) => void;
}) {
  const lines = snapshotLines(input, design.inputSnapshot);
  const gaps = courseDraftGap(input, design.inputSnapshot);
  const partnership = design.elements.find(item => item.name === '學習夥伴關係');
  const designNumber = project.designs.findIndex(item => item.id === design.id) + 1;
  const itemNumber = project.designs.findIndex(item => item.id === pre?.designId) + 1;
  const allRulesConfirmed = design.integration.every(rule => rule.status === 'confirmed');
  const missingRules = design.integration.some(rule => rule.status === 'missing');
  return <section className="card status-card" aria-label="課程草稿與核對狀態">
    <div className="eyebrow">先看這份是草稿還是設計</div>
    <h2>輸入草稿與設計快照</h2>
    <ol className="steps">{steps.map(step => <li key={step.label}><button type="button" aria-current={tab === step.tab ? 'step' : undefined} onClick={() => onTab(step.tab)}>{step.label}</button></li>)}</ol>
    <div className="split">
      <div>
        <h3>正在改的輸入草稿</h3>
        <p>{lines.draftSubject}</p>
        <p>{lines.draftCurriculum}</p>
        <p>{lines.draftIndicators}</p>
      </div>
      <div>
        <h3>目前設計快照</h3>
        <p>{lines.snapshotSubject}</p>
        <p>{lines.snapshotCurriculum}</p>
        <p>{lines.snapshotIndicators}</p>
        <p className="note">第 {designNumber} 版・{design.origin === 'manual-example' ? '人工範例' : design.origin === 'ai' ? 'AI 建議草稿' : '教師修訂'}。題組引用第 {itemNumber || '—'} 版。</p>
      </div>
    </div>
    <p className={gaps.length ? 'notice' : 'note'}>{gaps.length ? `草稿與設計快照不同：${gaps.join('、')}。前後測、規準與提示詞仍用設計快照，這不是已重新設計的課程。` : `輸入草稿與目前設計快照內容相同。${design.confirmedAt ? '教師已確認設計；仍不能據此宣稱課程已實施或學習成效。' : '設計仍待教師核對，不代表已實施。'}`}</p>
    <dl className="meta">
      <div><dt>設計確認</dt><dd>{design.confirmedAt ? '資料標記教師已確認' : '未確認'}</dd></div>
      <div><dt>整合規則</dt><dd>{allRulesConfirmed ? '資料標記教師已確認' : missingRules ? '尚缺整合規則' : '待教師確認'}</dd></div>
      <div><dt>前測題組</dt><dd>{mark(!!pre?.reviewedAt, '未確認')}、{mark(!!pre?.administeredAt, '未施測')}</dd></div>
      <div><dt>後測題組</dt><dd>{mark(!!post?.reviewedAt, '未確認')}、{mark(!!post?.administeredAt, '未施測')}</dd></div>
    </dl>
    <p className="note">教師確認與實際施測分開。先確認整合規則與設計，再審閱題組；只有真正施測後才記錄施測，並保留該版快照。</p>
    <div className="notice"><strong>尚未做學生共設計</strong><p>{partnership?.limitation ?? '尚未納入學生共同設計課程、成功標準或評量；不能稱完整實踐學習夥伴關係。'}</p><p>同儕互查只是教學安排。它不能寫成學生已經共同決定課程、成功標準或評量。</p></div>
  </section>;
}
