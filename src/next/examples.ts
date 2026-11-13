import { changeIntake, emptyIntake, type IntakeDraft } from './intake';

interface IntakeExample {
  id: string;
  label: string;
  note: string;
  route: IntakeDraft['route'];
  subject: string;
  grade: string;
  periods: string;
  title: string;
  topic: string;
  activityIdea: string;
  expectedPerformance: string;
  background: string;
  foundation: string;
  sourceText: string;
  teacherNotes: string;
  indicatorIds: string[];
}

// Adapted from the four simulated teacher inputs in NPDL Studio 2.0.
// Post-course example prose is intentionally excluded: none of these courses was administered.
export const INTAKE_EXAMPLES: readonly IntakeExample[] = [
  {
    id: 'existing-chemistry-rate', label: '已有課程・化學反應速率', note: '保留三節實驗與資料討論，補上比較條件及結論限制。', route: 'existing',
    subject: '化學', grade: '高二', periods: '3', title: '反應速率：從實驗數據到可信的判斷',
    topic: '如何判斷反應速率資料是否足以支持結論，並在新證據出現時修正說法？',
    activityIdea: '比較不同濃度的反應紀錄，檢查控制條件，討論結論能支持到哪裡。',
    expectedPerformance: '能引用表格資料提出有限結論，指出比較條件或證據不足之處。',
    background: '', foundation: '反應速率基本概念、表格閱讀與公平比較。',
    sourceText: '第一節認識反應快慢的生活現象，討論如何記錄時間。第二節在教師提供的安全條件下比較不同濃度的反應，記錄條件與結果。第三節比較各組紀錄，說明濃度與反應快慢的關係。原學習單主要記結果，尚未明確要求檢查公平比較、提出查證方式或說明結論範圍。',
    teacherNotes: '模擬填寫參考。學生已學反應速率基本概念並能讀簡單表格；「常把一次結果當成一定成立」只是教師待核對的起點假設，不是實測結論。',
    indicatorIds: ['critical-evaluate-information'],
  },
  {
    id: 'existing-geography-shade', label: '已有課程・校園遮蔭', note: '保留踏查與改善提案，加入資料限制與不同使用者需求。', route: 'existing',
    subject: '地理', grade: '高一', periods: '4', title: '校園熱點與遮蔭改善',
    topic: '如何用有限踏查資料選擇遮蔭改善位置，同時顧及不同使用者？',
    activityIdea: '分組踏查日照與使用情形，整理簡圖，提出遮蔭位置與取捨理由。',
    expectedPerformance: '能說明資料收集限制，對照不同使用者需求提出有條件的改善建議。',
    background: '', foundation: '讀圖、簡單資料整理與熱環境概念。',
    sourceText: '原規劃四節課：先認識熱環境與遮蔭，再以小組踏查記錄不同區域的日照、地表與使用情形，整理簡圖，最後選一處優先改善並提出理由。原本主要看紀錄完整與提案清楚；尚未安排核對各組測量時間差異，也未比較不同使用者的需求。',
    teacherNotes: '模擬填寫參考。學生讀圖及簡單數據能力、對不同使用者的理解都待教師核對；不蒐集真實個資。',
    indicatorIds: ['critical-evaluate-information', 'citizenship-diversity-equity'],
  },
  {
    id: 'new-chemistry-claims', label: '尚無課程・清潔用品廣告', note: '從生活中的廣告主張與證據判讀開始發想。', route: 'new',
    subject: '化學', grade: '高一', periods: '3', title: '清潔用品的廣告，哪些說法值得相信？',
    topic: '學生如何區分觀察結果與廣告推論，引用資料提出有限判斷，並指出哪種新證據會改變看法？',
    activityIdea: '比較兩則清潔用品廣告與教師提供的測試資料，分辨觀察與推論。',
    expectedPerformance: '能引用資料說明主張可信的範圍，提出還需要的證據。',
    background: '', foundation: '觀察與推論的區別、生活用品成分的基礎閱讀。',
    sourceText: '',
    teacherNotes: '模擬填寫參考。前後測應提供理解所需資料，不把未教過的化學術語當能力題門檻。',
    indicatorIds: ['critical-evaluate-information'],
  },
  {
    id: 'new-english-audience', label: '尚無完整課程・英語減塑倡議', note: '從受眾、表達理由與回饋後修訂發想。', route: 'new',
    subject: '英語文', grade: '高一', periods: '4', title: '讓不同對象聽懂減塑倡議',
    topic: '學生如何為同齡學生與家長設計不同的減塑訊息，說明受眾需求，再依回饋修改內容？',
    activityIdea: '比較兩種受眾的關心點，寫出不同版本訊息並依模擬回饋修訂。',
    expectedPerformance: '能說明訊息如何對應受眾，指出回饋後的具體修改理由。',
    background: '', foundation: '基本英語表達、受眾與語氣的差異。',
    sourceText: '',
    teacherNotes: '模擬填寫參考。已有活動構想但未有完整教案；英文句型是表達工具，不能把文法或字彙量直接判成 NPDL 階段。',
    indicatorIds: ['communication-audience-impact', 'communication-reflection'],
  },
];

export function intakeFromExample(id: string): IntakeDraft {
  const sample = INTAKE_EXAMPLES.find(item => item.id === id);
  if (!sample) throw new Error('找不到這組模擬範例。');
  return changeIntake(emptyIntake(sample.route), {
    title: sample.title, subject: sample.subject, grade: sample.grade, periods: sample.periods,
    topic: sample.topic, activityIdea: sample.activityIdea, expectedPerformance: sample.expectedPerformance,
    background: sample.background, foundation: sample.foundation, sourceText: sample.sourceText, teacherNotes: sample.teacherNotes,
    indicatorIds: [...sample.indicatorIds],
  });
}
