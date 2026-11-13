import type { DesignVersion } from './types';

export interface AssessmentStrategy {
  id: string;
  label: string;
  material: string;
  evidence: string;
  pitfall: string;
  keywords: readonly string[];
}

function strategy(id: string, label: string, material: string, evidence: string, pitfall: string, keywords: readonly string[]): AssessmentStrategy {
  return { id, label, material, evidence, pitfall, keywords };
}

// 題組保存策略代碼。調整建議文字或關鍵詞時保留既有代碼，讓舊題組仍能使用原設定。
const CATALOG: ReadonlyMap<string, readonly AssessmentStrategy[]> = new Map([
  ['國語文', [
    strategy('chinese-argument-check', '主張與論據查核',
      '兩則短評或投書，搭配能核查其中主張的原文節錄、訪談或文字紀錄。',
      '引用一句原文及一筆相符紀錄，區分主張、論據與推論，說明支持範圍或反例。',
      '不要把措辭肯定當作證據充分，或以個人經驗推及所有人。',
      ['校刊評論', '評論', '論據', '論點', '論證', '投書', '主張', '反方', '因果論證']),
    strategy('chinese-text-comparison', '多文本觀點比較',
      '兩段足以獨立理解的文本，附必要的人物關係或作品脈絡。',
      '分別摘引關鍵語句，說明兩篇在立場、敘事視角或表現方式上的差異。',
      '不要以題材相同推論立場相同，或把人物說法當成作者觀點。',
      ['多文本', '比較閱讀', '敘事視角', '人物', '散文', '古文', '新詩', '小說', '敘事']),
    strategy('chinese-language-context', '語境中的表達選擇',
      '同一訊息的兩種表述，附受眾、目的及一項實際限制。',
      '比較哪一個措辭更符合指定受眾和目的，引用原句說明或提出改寫。',
      '不要僅憑字詞較華麗或語氣較強，就判定表達較有效。',
      ['修辭', '用字', '語境', '受眾', '改寫', '語氣', '措辭', '標題']),
  ]],
  ['英語文', [
    strategy('english-text-evidence', '英語文本推論',
      '兩段符合年級的短篇英文或一篇英文搭配簡短補充，提供影響理解的必要字詞。',
      '用文本中的英文詞句或兩處訊息說明推論，可用中文說理，除非本課目標要求英語作答。',
      '不要以單字重複或個人常識代替全文線索，前後測的語言難度保持接近。',
      ['閱讀理解', '文本推論', '篇章', '主旨', '作者觀點', '敘事', 'reading']),
    strategy('english-message-decision', '資訊篩選與情境溝通',
      '兩則英文通知、郵件或對話，搭配文字表格呈現時間、對象或條件。',
      '找出符合指定條件的訊息並說明理由，或依受眾和目的選擇合適回覆。',
      '不要只找相同字眼；同時核對日期、對象與例外條件。',
      ['郵件', '電子郵件', '對話', '通知', '行程', '點餐', '服務', '口語', '旅行', 'email']),
  ]],
  ['數學', [
    strategy('math-distribution', '分布與統計量判讀',
      '用表格列兩組少量原始數值或次數，樣本量、單位及統計定義明確。',
      '引用兩組具體數值、次數或簡短算式，比較集中、離散或特定門檻下的表現，說明哪一個統計量支持判斷。',
      '不要以平均數相同推論分布相同，也不要在樣本數不同時只比次數。',
      ['平均數', '分布', '全距', '中位數', '標準差', '四分位', '統計量', '樣本', '機率', '離散']),
    strategy('math-relationship', '數量關係與變化',
      '給短情境與少量對應數值或關係式，說清楚變數、單位及比較範圍。',
      '用表中的數值或關係式比較變化率、門檻或交點前後的差異，列出可核對的數學理由。',
      '不要混用總量、增量與單位量，或超出給定範圍直接外推。',
      ['函數', '數列', '單價', '費率', '變化率', '斜率', '交點', '比例', '指數', '對數', '遞迴', '起始費用']),
    strategy('math-condition-check', '條件檢驗與反例',
      '以文字或表格列定義、條件與候選例子，資料足以獨立檢驗。',
      '指出使用的條件及對應算式，判斷候選是否成立；需要時提出一個符合前提的反例。',
      '不要把單一例子當作通則，或用不符合前提的例子反駁。',
      ['幾何', '三角形', '圓', '向量', '充分條件', '必要條件', '證明', '反例', '不等式', '排列', '組合']),
  ]],
  ['物理', [
    strategy('physics-fair-measurement', '公平量測與條件比較',
      '以表格列操作條件、量測量、單位及少量重複紀錄，保留可比與不可比的對照。',
      '選出只在目標條件有差異的紀錄，用數值支持或限制物理主張。',
      '不要混用條件或物理量，或只根據一次測量斷言普遍關係。',
      ['量測', '誤差', '對照組', '變因控制', '電路', '電阻', '滑動', '摩擦', '自由落體']),
    strategy('physics-model-check', '模型預測與觀察核對',
      '用文字給模型、適用條件及兩種預測，搭配一小組觀察或量測表。',
      '找出能區分兩個解釋的量，對照觀察與模型預測，說明哪項條件限制結論。',
      '不要把模型預測當成觀察事實，也不要忽略適用的速度、尺度或環境。',
      ['模型', '動量', '守恆', '波動', '光學', '干涉', '能量轉換', '熱傳', '天體運動']),
  ]],
  ['化學', [
    strategy('chemistry-reaction-comparison', '反應條件與證據比較',
      '提供一小組條件與結果的表格，說明反應條件、重複次數和讀數代表的意義。',
      '指出可比較的紀錄，用數值解釋差異，說明量到的是時間、產量、速率或其他量。',
      '不要把到達終點的時間當成速率本身，或從混合變因的結果判定因果。',
      ['反應速率', '反應快慢', '催化', '反應時間', '反應速率常數', '碰撞頻率', '濃度', '溫度', '變因控制']),
    strategy('chemistry-substance-identification', '物質性質與鑑別',
      '用短文字或小表提供候選物的已知性質和測試現象，題內補充判讀規則。',
      '串聯至少兩項性質或觀察以排除候選，指出仍缺哪一項資料才能確認。',
      '不要只靠單一顏色、外觀或反應現象認定物質，也不要求學生實作危險測試。',
      ['酸鹼', '指示劑', '溶解度', '分離', '純度', '鑑別', '離子檢驗', '萃取', '沉澱']),
    strategy('chemistry-particle-model', '粒子模型與現象推論',
      '用簡短文字或計數表提供粒子模型的條件、可觀察現象與候選解釋。',
      '區分可觀察事實與微觀解釋，用題內資料核對模型可解釋的範圍。',
      '不要把模型的符號當成物質本身，也不要把質量守恆與各物質數量不變混為一談。',
      ['粒子模型', '分子結構', '化學鍵', '晶體', '莫耳', '質量守恆', '平衡', '氧化還原']),
  ]],
  ['生物', [
    strategy('biology-field-comparison', '生態調查與採樣比較',
      '用一張調查表列不同棲地或樣區的觀察紀錄，包含面積、時段、方法或觀察努力量。',
      '先指出調查條件是否相近，再引用物種或個體的紀錄，說明能否比較及結論範圍。',
      '不要混淆物種數和個體數，或把觀察到的次數直接當作族群多寡。',
      ['生物多樣性', '物種多樣性', '物種', '生態系', '棲地', '樣區', '樣線', '族群', '鳥類調查', '生態調查']),
    strategy('biology-experimental-control', '生物實驗與對照',
      '用表格列比較組與對照組的處理條件、量測時間及結果，交代指標的意義。',
      '辨認只改變一個待查條件的組別，用測量結果支持或質疑主張，指出可能的混淆。',
      '不要省略對照組或把時間、個體差異與處理效果混為一談。',
      ['酵素', '澱粉酶', '發芽', '光合作用', '生長條件', '對照組', '變因控制', '呼吸作用', '實驗處理']),
    strategy('biology-structure-function', '生物構造與功能',
      '將觀察特徵、位置或構造差異整理成短文字紀錄或比較表。',
      '引用可觀察構造解釋它與功能的關聯，區分觀察結果與由此推得的解釋。',
      '不要從單一外觀特徵斷定完整功能，也不要用功能名稱取代構造證據。',
      ['細胞構造', '構造與功能', '氣孔', '葉脈', '葉片', '器官', '組織', '演化適應', '細胞分裂', '遺傳']),
  ]],
  ['地球科學', [
    strategy('earth-science-process', '多種紀錄與地球演變',
      '以日期、位置或深度排列少量觀測紀錄，附必要的術語解釋。',
      '將兩種證據放在相同時空脈絡比較，判斷哪一個演變或機制解釋較有支持。',
      '不要用單點或單次觀察代表整個時段，也不要用單一證據排除所有解釋。',
      ['地層', '化石', '板塊', '地質', '岩石循環', '天體', '觀測軌跡', '月相', '潮汐']),
    strategy('earth-science-risk', '環境觀測與風險判讀',
      '用表格呈現不同時段或地點的監測值、單位與已知限制，另交代任務的判斷條件。',
      '引用符合時空條件的監測資料說明警戒範圍，區分目前觀察與未來預測。',
      '不要將一次事件視為長期趨勢，也不要把有風險解讀成必然發生。',
      ['地震', '震度', '颱風', '氣象', '空氣品質', '降雨', '海溫', '氣候', '警戒']),
  ]],
  ['自然科學', [
    strategy('science-inquiry-control', '探究設計與條件控制',
      '給兩種測試方案或一組含對照的紀錄表，說明測量單位和重複方式。',
      '辨認公平比較的條件，指出可用紀錄與可改進的量測方法。',
      '不要同時改動多個變因後直接歸因，也不要把增加次數當成已排除偏差。',
      ['變因', '對照組', '公平比較', '量測', '重複', '研究設計', '試驗']),
    strategy('science-evidence-explanation', '觀察、證據與解釋',
      '用兩則簡短觀察紀錄或資料表，附兩種候選解釋和必要背景。',
      '指出能區分兩種解釋的具體觀察，說明資料目前支持或不足以支持什麼。',
      '不要用相關或同時發生當作因果，也不要把解釋重述成證據。',
      ['機制', '模型', '因果', '替代解釋', '觀察推論', '證據解釋']),
  ]],
  ['地理', [
    strategy('geography-spatial-pattern', '空間分布與尺度比較',
      '用文字描述區位關係或用表格列區域、距離、方向及相同單位的數據。',
      '引用兩地的區位和資料比較分布，說明結論適用於哪個範圍或尺度。',
      '不要把行政區平均當作每個地點的情況，也不要用不同尺度直接比較。',
      ['空間分布', '區位', '距離', '尺度', '分布', '聚落', '都市化', '遷移', '地區差異']),
    strategy('geography-place-decision', '人地互動與區位決策',
      '給地點條件表和兩種需求的短文字，標明時間、對象和可行限制。',
      '引用地點與人群需求說明一項方案的取捨，辨識哪些限制會改變選擇。',
      '不要將某地的做法直接套到不同環境，也不要忽略移動或資源可及性。',
      ['土地利用', '地點選擇', '交通可及性', '環境承載', '防災', '地景', '產業區位', '資源分配']),
  ]],
  ['歷史', [
    strategy('history-source-corroboration', '史料脈絡與互證',
      '給兩段必要長度的史料摘文，標示年代、作者身分和撰寫目的；模擬材料須明示。',
      '引用兩段史料比較陳述，說明作者立場或目的如何限制可以支持的結論。',
      '不要把單一史料當成全貌，或以現代價值替代史料中的脈絡。',
      ['史料', '互證', '回憶錄', '報刊', '觀點', '檔案', '口述歷史', '史書', '證言']),
    strategy('history-change-causation', '歷史變遷與因果',
      '提供少量時序文字或事件表，清楚區分時間、地區和不同群體的處境。',
      '引用事件先後和一項具體條件，區分短期變化、長期延續與可能原因。',
      '不要以先發生推定為唯一原因，也不要把所有地區視為同時變化。',
      ['變遷', '延續', '時序', '因果', '改革', '制度演變', '工業化', '殖民', '革命']),
  ]],
  ['公民與社會', [
    strategy('civics-rules-stakeholders', '規範、權益與不同處境',
      '提供簡短的模擬規範、不同群體的意見與可核對的觀察表。',
      '引用規範條件與一筆紀錄，區分對不同人的影響，說明哪個主張仍待查。',
      '不要把單一意見當作普遍經驗，也不要把價值立場當成事實證據。',
      ['規範', '手機管理', '權益', '公平', '公共參與', '學生自治', '利害關係', '校規', '權利']),
    strategy('civics-public-claims', '公共主張與證據核對',
      '給兩項公共主張，附來源、範圍清楚的簡短調查或觀察紀錄。',
      '找出支持及限制主張的資料，說明樣本或觀察範圍如何影響結論。',
      '不要用民調多寡證明因果，也不要把所有意見當成同一類證據。',
      ['公共政策', '民調', '媒體識讀', '假訊息', '倡議', '公共議題', '民主討論', '投票']),
    strategy('civics-economic-tradeoff', '經濟抉擇與代價比較',
      '用數值表列兩個方案的成本、效益、適用條件及受影響者。',
      '引用相同單位的成本或效益資料，按條件說明方案差異與取捨。',
      '不要只看總效益忽略成本與分配，也不要把個人效益直接當作公共效益。',
      ['經濟', '機會成本', '成本效益', '供需', '市場', '價格', '外部性', '消費']),
  ]],
]);

const FALLBACK: readonly AssessmentStrategy[] = [
  strategy('general-evidence', '主張與證據查核',
    '提供兩則足以獨立理解的短資料或文字表格，交代來源和判斷條件。',
    '指出能支持或質疑主張的具體紀錄，說明結論可以說到哪裡。',
    '不要以偏概全，也不要靠選項的語氣猜測。',
    ['主張', '論據', '來源', '資料可信度', '反例']),
  strategy('general-condition-comparison', '條件與結果比較',
    '用少量文字或表格列兩組情境、條件和結果，說明哪些紀錄可相互比較。',
    '引用條件和結果的差異提出有限判斷，指出若要更確定還缺哪種證據。',
    '不要以相同結果推定條件相同，或把一個時段的結果外推到其他時段。',
    ['對照組', '變因', '實驗', '條件比較', '差異', '調查']),
];

const SUBJECT_ALIASES: ReadonlyMap<string, string> = new Map([
  ['國文', '國語文'], ['英文', '英語文'], ['公民', '公民與社會'], ['公民社會', '公民與社會'], ['自然', '自然科學'],
]);

export function strategiesFor(subject: string): readonly AssessmentStrategy[] {
  const key = subject.normalize('NFKC').trim();
  return CATALOG.get(SUBJECT_ALIASES.get(key) ?? key) ?? FALLBACK;
}

const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');

function keywordScore(keywords: readonly string[], haystack: string): number {
  return keywords.reduce((total, phrase) => {
    const key = normalized(phrase);
    return total + (haystack.includes(key) ? Math.min(key.length, 6) : 0);
  }, 0);
}

export function recommendStrategy(design: DesignVersion): AssessmentStrategy {
  const input = design.inputSnapshot;
  const options = strategiesFor(input.subject);
  const focus = normalized([input.title, input.topic].join('|'));
  const courseEvidence = normalized([
    input.drivingQuestion ?? '', input.finalProduct ?? '', design.summary,
    ...design.goals.filter(goal => goal.kind === 'academic').flatMap(goal => [goal.text, goal.success]),
    ...design.criteria.flatMap(criterion => [criterion.label, criterion.observable]),
    ...design.activities.flatMap(activity => [activity.name, activity.task, activity.knowledgeUse, activity.evidence]),
  ].join('|'));

  // 明確的單元主題優先；主題沒有線索或分數相同時，才依課程已設定的任務與證據。
  let best = options[0], bestFocus = -1, bestContext = -1;
  for (const option of options) {
    const titleScore = keywordScore(option.keywords, focus);
    const courseScore = keywordScore(option.keywords, courseEvidence);
    if (titleScore > bestFocus || (titleScore === bestFocus && courseScore > bestContext)) {
      best = option;
      bestFocus = titleScore;
      bestContext = courseScore;
    }
  }
  return best;
}
