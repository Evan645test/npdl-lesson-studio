import { describe, expect, it } from 'vitest';
import { activityPeriodLoadNotice } from './activityPeriodReminder';

describe('activityPeriodLoadNotice', () => {
  it('兩類以上負擔活動時顯示提醒', () => {
    expect(activityPeriodLoadNotice('學生撰寫報告後發表成果')).toBe('這一節同時要做 撰寫、發表，時間可能不夠，建議拆成兩節或刪減。');
    expect(activityPeriodLoadNotice('展示海報並依回饋修訂內容')).toBe('這一節同時要做 發表、修改，時間可能不夠，建議拆成兩節或刪減。');
    expect(activityPeriodLoadNotice('寫報告、展示、再修改')).toBe('這一節同時要做 撰寫、發表、修改，時間可能不夠，建議拆成兩節或刪減。');
  });
  it('單一類或無關字詞不提醒', () => {
    expect(activityPeriodLoadNotice('分組討論並整理想法')).toBeNull();
    expect(activityPeriodLoadNotice('請學生發表看法')).toBeNull();
    expect(activityPeriodLoadNotice('')).toBeNull();
  });
});
