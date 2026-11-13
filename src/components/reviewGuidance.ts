export interface ReviewFacts {
  phase: 'pre' | 'post';
  hasPre: boolean;
  hasPost: boolean;
  preReviewed: boolean;
  preAdministered: boolean;
  postReviewed: boolean;
  postAdministered: boolean;
  sourceChanged: boolean;
  designConfirmed: boolean;
  rulesConfirmed: boolean;
  rulesMissing: boolean;
  sameDesign: boolean;
  blueprintComparable: boolean;
  locked: boolean;
  saveFailed: boolean;
  cancelled: boolean;
}

export interface ReviewGuidance {
  title: string;
  detail: string;
  showProgress: false;
  singleStage: false;
}

export const PRE_LIMIT = '前測沒有課程應用，也沒有自評。';
export const REFLECTION_LIMIT = '自評只在後測。可以選擇目前沒有足夠證據；不扣分、不平均，也不改變能力題結果。';
export const PDF_LIMIT = 'PDF 嵌入本機中文字型，文字可選取與搜尋；要修改內容請用 Word 或 Markdown。';
export const STUDENT_LIMIT = '學生題本不含選項支持、限制、規準、整合規則與判讀提示詞。';
export const SNAPSHOT_LIMIT = '題目、選項和支持限制是這份題組快照。這一頁不能改寫；要改題請另生成新版。已施測的版本留在清單裡。';

export function reviewGuidance(facts: ReviewFacts): ReviewGuidance {
  const base = { showProgress: false as const, singleStage: false as const };
  if (facts.locked || facts.saveFailed) {
    return { ...base, title: '這頁的修改還沒存進瀏覽器', detail: '原稿還在。請下載備份，空出空間後再試一次。重載前不要關掉這頁。' };
  }
  if (facts.cancelled) {
    return { ...base, title: '這次請求已取消', detail: '草稿留著，沒有寫進題組。' };
  }
  if (!facts.hasPre) {
    return { ...base, title: '先保存完整前測', detail: '前測要整份成功，才補後測。後測失敗不會把前測拿掉。' };
  }
  if (facts.sourceChanged) {
    return { ...base, title: '課程草稿已和題組來源不同', detail: '已施測的原版還在版本清單，可以回查。新草稿不會改那一版題目。' };
  }
  if (facts.hasPost && !facts.sameDesign) {
    return { ...base, title: '前後測不是同一份設計', detail: '兩份題組先分開看。不要把差異寫成能力變化。' };
  }
  if (!facts.designConfirmed) {
    return { ...base, title: '先確認題組引用的設計', detail: '展開「AI 生成、版本確認與文件」，依序按「核對此起點、課綱與子指標」、「確認此設計的整合規則」、「確認目前設計」；已完成的步驟不用重按，再回來確認題組。' };
  }
  if (!facts.rulesConfirmed || facts.rulesMissing) {
    return { ...base, title: '整合規則還不能合成一個階段', detail: '只列各題證據。規則不足時，不給單一階段。' };
  }
  if (facts.phase === 'pre' && !facts.preReviewed) {
    return { ...base, title: '先確認這份前測', detail: '確認表示題組可以拿去用，還不是已經施測。' };
  }
  if (facts.phase === 'pre' && !facts.preAdministered) {
    return { ...base, title: '學生做完才記錄施測', detail: '沒有真正施測，就不要按記錄。' };
  }
  if (!facts.hasPost) {
    return { ...base, title: '現在只補後測', detail: '前測已保存。後測若失敗或取消，重新載入後只補後測。' };
  }
  if (facts.phase === 'post' && !facts.postReviewed) {
    return { ...base, title: '後測三部分分開看', detail: '能力題、課程應用、自評各有用途，不合成一個分數。' };
  }
  if (facts.phase === 'post' && !facts.postAdministered) {
    return { ...base, title: '後測尚未記錄施測', detail: '確認後測不等於已施測。配對的前測要先有施測紀錄。' };
  }
  return { ...base, title: '這版可以帶走', detail: '下載前再核對版本、部分和用途。檔案還沒開始下載時，畫面不會說已經下載。' };
}

export function comparisonHeadline(facts: Pick<ReviewFacts, 'hasPre' | 'hasPost' | 'preAdministered' | 'postAdministered' | 'sameDesign' | 'blueprintComparable' | 'rulesConfirmed' | 'rulesMissing'>): string {
  if (!facts.hasPre || !facts.hasPost) return '目前沒有可配對的前後測，不顯示能力變化。';
  if (!facts.preAdministered) return '前測尚未記錄實際施測，不能把兩份題本的差異寫成變化。';
  if (!facts.postAdministered) return '後測尚未記錄實際施測，不能把兩份題本的差異寫成能力變化。';
  if (!facts.sameDesign) return '前後測引用的設計不同，不宜比較。';
  if (!facts.blueprintComparable) return '藍圖中的比較條件尚待核對或不宜比較；目前不顯示能力變化。';
  if (!facts.rulesConfirmed || facts.rulesMissing) return '規則不足，只列分項證據，不給單一階段。';
  return '施測條件仍須教師核對；只有藍圖標為可作有限比較時才可作有限對照。相同題數不是等值，也沒有總分或名次。';
}

export function versionLabel(reviewed: boolean, administered: boolean, sourceChanged: boolean): string {
  if (sourceChanged) return '來源已變，原版仍可回查';
  if (administered) return '已施測';
  if (reviewed) return '已確認，尚未施測';
  return '待確認';
}
