import { expect, it } from 'vitest';
import { splitSummary } from './FullLessonPreview';

it('R31 單元摘要拆出前言、建議條列與結語；沒有編號時原樣保留', () => {
  const text = '本課程設計主線緊扣驅動問題。建議重點調整：(1) 明確定義學生產出，以利形成性回饋；(2) 每節練習一個能力層次；(3) 資訊一律用教師模擬資料。原課程未見學生共同設計。四大元素安排恰當。';
  expect(splitSummary(text)).toEqual({
    intro: '本課程設計主線緊扣驅動問題。',
    items: ['明確定義學生產出，以利形成性回饋。', '每節練習一個能力層次。', '資訊一律用教師模擬資料。'],
    outro: '原課程未見學生共同設計。四大元素安排恰當。',
  });
  expect(splitSummary('沒有編號的摘要。')).toEqual({ intro: '沒有編號的摘要。', items: [], outro: '' });
});
