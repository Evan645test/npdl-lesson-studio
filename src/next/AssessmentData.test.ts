import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sampleSet } from '../domain/thresholdSet.test-helper';
import { SetCard } from './SetPairView';

const render = (data: string) => renderToStaticMarkup(createElement(SetCard, {
  set: { ...sampleSet('critical-evaluate-information', ['criterion-1'], 'test'), data },
  label: '後測',
}));

describe('評量資料保留欄列關聯', () => {
  it('頻數資料用表頭與列標題呈現，零頻數也保留', () => {
    const html = render('等候時間｜4 分鐘｜6 分鐘｜8 分鐘\n東側筆數｜1｜2｜2\n西側筆數｜2｜0｜4');
    expect(html).toContain('<table');
    expect(html).toContain('<th scope="col">6 分鐘</th>');
    expect(html).toContain('<th scope="row">西側筆數</th><td>2</td><td>0</td><td>4</td>');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('後測情境資料');
  });
  it('Markdown 分隔列不被當成觀察值', () => {
    const html = render('| 地點 | 種類數 | 個體數 |\n| --- | ---: | ---: |\n| 花圃 | 3 | 19 |');
    expect(html).toContain('<th scope="col">種類數</th>');
    expect(html).toContain('<th scope="row">花圃</th><td>3</td><td>19</td>');
    expect(html).not.toContain('<td>---');
  });
  it.each([
    '一段觀察文字，保留原意。\n另一段紀錄。',
    '地點｜種類數｜個體數\n花圃｜3',
    '甲｜3｜19\n乙｜5｜13',
    '花圃｜3｜19\n草地｜5｜13',
    '花圃｜定點｜3｜19\n草地｜定點｜5｜13',
    '補充說明\n地點｜數量\n花圃｜3',
  ])('無法確定表頭或欄數時保留完整原文：%s', data => {
    const html = render(data);
    expect(html).not.toContain('<table');
    expect(html).toContain(data);
  });
  it('有明確分隔列時可使用純數字欄名', () => {
    const html = render('| 等候分鐘 | 4 | 6 |\n| --- | --- | --- |\n| 東側 | 1 | 2 |');
    expect(html).toContain('<th scope="col">4</th>');
    expect(html).toContain('<th scope="row">東側</th><td>1</td><td>2</td>');
  });
  it('資料中的標籤只當文字，不能變成 HTML', () => {
    const html = render('地點｜數量\n<img src=x onerror=alert(1)>｜3');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
});

