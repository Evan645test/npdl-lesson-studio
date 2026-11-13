import { SetCard } from '../next/SetPairView';
import { STAGES, type DesignVersion, type Item } from '../domain/types';
import { REFLECTION_LIMIT } from './reviewGuidance';

const conditionLabels = ['必要知識', '閱讀', '複雜度', '推理', '提示條件'] as const;

function Question({ item, number, design, purpose }: { item: Item; number: number; design: DesignVersion | undefined; purpose: string }) {
  const criterion = design?.criteria.find(entry => item.criterionIds.includes(entry.id));
  const pair = design?.blueprint.find(entry => entry.preId === item.id || entry.postId === item.id);
  return <article className="question">
    <div className="eyebrow">{purpose}・第 {number} 題</div>
    <h3>{item.title}</h3>
    <p>{item.context}</p>
    <div className="data">{item.data}</div>
    <p><strong>{item.prompt}</strong></p>
    <ol className="options">{item.options.map(option => <li key={option.id}><span className="option-id">{option.id}</span>{option.text}</li>)}</ol>
    <p className="note">對照規準：{criterion ? `${criterion.label}（${criterion.id}）` : item.criterionIds.join('、') || '這題尚未連到規準'}</p>
    {pair && <p className="notice"><strong>這題的比較條件：{pair.status}</strong><br />{pair.reason}</p>}
    <details>
      <summary>教師核對：逐選項支持與限制</summary>
      {item.options.map(option => <div className="evidence" key={option.id}><strong>選 {option.id} 只支持</strong><p>{option.supports.join('；')}</p><span>限制：{option.limitations.join('；')}</span></div>)}
      <p className="note">選擇既定敘述，不能寫成學生自行提出理由、實際查證或真實行動。選項沒有固定對應階段或分數。這段只給教師看，不放進學生題本。</p>
      <dl>{Object.entries(item.conditions).map(([key, value], index) => <div key={key}><dt>{conditionLabels[index]}</dt><dd>{value}</dd></div>)}</dl>
    </details>
    {item.applicationCriteria && <div className="notice"><strong>本題獨立應用判準</strong><p>學科：{item.applicationCriteria.academic}</p><p>能力應用：{item.applicationCriteria.capability}</p><p className="note">應用結果獨立，不加入能力階段變化。</p></div>}
  </article>;
}

export function AssessmentPanel({ assessment, design }: { assessment: import('../domain/types').AssessmentVersion | undefined; design?: DesignVersion }) {
  if (!assessment) return <p>這個版本尚未建立題組。</p>;
  if (assessment.format) return <section className="part" aria-label="門檻題組">{(assessment.sets ?? []).map(set => <SetCard set={set} label={assessment.phase === 'pre' ? '前測' : '後測'} key={set.id} />)}</section>;
  const linked = design;
  return <>
    <div className="section-heading">
      <div>
        <div className="eyebrow">{assessment.phase === 'pre' ? '生活情境' : '三種證據分開'}</div>
        <h2>{assessment.phase === 'pre' ? '前測：讓生活情境說話' : '後測：三種證據，各有用途'}</h2>
      </div>
    </div>
    {assessment.phase === 'pre' && <><p className="note">前測沒有課程應用，也沒有自評。</p><p className="note">能力題只看選項支持與限制；比較條件未核對前，不能寫成進步。</p></>}
    <section className="part" aria-label={assessment.phase === 'pre' ? '前測能力題' : '可比較能力題'}>
      {assessment.phase === 'post' && <div className="section-heading"><div><div className="eyebrow">第一部分</div><h2>後測第一部分：可比較能力題</h2></div></div>}
      {assessment.phase === 'post' && <p>用途是對照前測的選項辨識。限制是比較條件未核對前不能寫成變化，也不和其他部分合成總分。</p>}
      {assessment.capability.map((item, index) => <Question item={item} number={index + 1} design={linked} purpose={assessment.phase === 'pre' ? '前測能力題' : '可比較能力題'} key={item.id} />)}
    </section>
    {assessment.phase === 'post' && <>
      <section className="part" aria-label="課程應用題">
        <div className="section-heading divider"><div><div className="eyebrow">第二部分・獨立呈現</div><h2>學科與能力的課程應用</h2></div></div>
        <p>用途是看這門課的學科知識能不能用在新問題。限制是不加入前後能力階段，也不補能力題缺少的證據。</p>
        {assessment.application.map((item, index) => <Question item={item} number={index + 1} design={linked} purpose="課程應用題" key={item.id} />)}
      </section>
      <section className="part" aria-label="自評與課程證據">
        <div className="section-heading divider"><div><div className="eyebrow">第三部分・只在後測</div><h2>回看自己的課程證據</h2></div></div>
        <p>{REFLECTION_LIMIT}</p>
        {assessment.reflection.map(item => {
          const clues = item.activityIds.map(id => linked?.activities.find(activity => activity.id === id)?.name ?? `${id}（對不到活動，不補名稱）`);
          return <article className="card" key={item.indicatorId}>
            <h3>課程自評</h3>
            {item.descriptions.map((description, index) => <p key={description}><span className="tag">{STAGES[index]}</span> {description}</p>)}
            <p className="notice">{item.noEvidenceLabel}</p><p>選這項不扣分，也不判成最低階。</p>
            <p><strong>活動與作業回想線索：</strong>{clues.join('、')}</p>
            <p><strong>一句具體證據：</strong>{item.evidencePrompt}</p>
            <p className="note">這是題本上的填寫提示。這裡沒有上傳學生作答的地方，也不會把自評算進能力階段。</p>
          </article>;
        })}
      </section>
    </>}
  </>;
}
