import { describe, expect, it } from 'vitest';
import { comparisonHeadline, reviewGuidance, type ReviewFacts } from './reviewGuidance';

const ready: ReviewFacts = {
  phase: 'post', hasPre: true, hasPost: true, preReviewed: true, preAdministered: true,
  postReviewed: true, postAdministered: true, sourceChanged: false, designConfirmed: true, rulesConfirmed: true,
  rulesMissing: false, sameDesign: true, blueprintComparable: true, locked: false, saveFailed: false, cancelled: false,
};

describe('評量頁下一步', () => {
  it('任何狀態都不顯示進步，也不給單一階段', () => {
    for (const facts of [
      ready,
      { ...ready, hasPost: false, phase: 'pre' as const },
      { ...ready, rulesConfirmed: false },
      { ...ready, sourceChanged: true },
      { ...ready, saveFailed: true },
    ]) {
      const guidance = reviewGuidance(facts);
      expect(guidance.showProgress).toBe(false);
      expect(guidance.singleStage).toBe(false);
    }
  });

  it('沒有後測時說明不顯示能力變化', () => {
    expect(comparisonHeadline({ ...ready, hasPost: false })).toContain('不顯示能力變化');
    expect(reviewGuidance({ ...ready, hasPost: false, phase: 'pre' }).detail).toContain('只補後測');
  });

  it('規則不足時不合成一個階段', () => {
    expect(reviewGuidance({ ...ready, rulesConfirmed: false }).detail).toContain('不給單一階段');
    expect(comparisonHeadline({ ...ready, rulesMissing: true })).toContain('不給單一階段');
  });

  it('設計未確認時指出實際區塊與三個按鈕', () => {
    const guidance = reviewGuidance({ ...ready, phase: 'pre', designConfirmed: false, rulesConfirmed: false });
    expect(guidance.title).toContain('確認題組引用的設計');
    for (const label of ['AI 生成、版本確認與文件', '核對此起點、課綱與子指標', '確認此設計的整合規則', '確認目前設計']) expect(guidance.detail).toContain(label);
  });

  it('來源改變時保留回查，儲存失敗與取消都留原稿', () => {
    expect(reviewGuidance({ ...ready, sourceChanged: true }).detail).toContain('回查');
    expect(reviewGuidance({ ...ready, saveFailed: true }).detail).toContain('備份');
    expect(reviewGuidance({ ...ready, cancelled: true }).detail).toContain('草稿');
  });

  it('前測未施測時不把題本差異寫成變化', () => {
    expect(comparisonHeadline({ ...ready, preAdministered: false })).toContain('不能把兩份題本的差異寫成變化');
  });
  it('後測未施測或藍圖條件待核對時不顯示能力變化', () => {
    expect(comparisonHeadline({ ...ready, postAdministered: false })).toContain('不能把兩份題本的差異寫成能力變化');
    expect(comparisonHeadline({ ...ready, blueprintComparable: false })).toContain('不顯示能力變化');
  });
});
