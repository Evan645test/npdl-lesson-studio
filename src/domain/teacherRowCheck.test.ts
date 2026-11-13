import { expect,it } from 'vitest';
import { numericTable, verifyExampleRows } from './teacherRowCheck';

const header='｜實驗編號｜溫度(°C)｜起始濃度(mol/L)｜體積(mL)｜到達混濁門檻時間(s)｜備註｜';
const one='｜1｜25｜0.10｜50｜60｜三次獨立測量，均於60±2 s間完成｜';
const two='｜2｜25｜0.20｜50｜30｜三次獨立測量，均於30±1 s間完成｜';
const table=numericTable([header,'｜---｜---｜---｜---｜---｜---｜',one,two].join('\n'),[
 {id:'G1-M4',text:one},{id:'G1-M5',text:two},
]);
it('合法引文也必須配到對應的秒數及具名列，不能從另一列借值',()=>{
 expect(verifyExampleRows('從開始到混濁是30秒。',table,['G1-M4'],[])).toMatchObject({quote:one});
 expect(verifyExampleRows('第2組從開始到混濁是60秒。',table,['G1-M4','G1-M5'],[])).toMatchObject({quote:two});
 expect(verifyExampleRows('0.10 mol/L 是30秒，0.20 mol/L 是60秒。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('0.10 mol/L 是60秒，0.20 mol/L 是30秒。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('第2組從開始到混濁是30秒。',table,['G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('第1組從開始到混濁是60秒。',table,['G1-M4'],[])).toBeUndefined();
});
it('正確換單位、可重算的倍數或後續補測不誤判為原始數據',()=>{
 expect(verifyExampleRows('第2組是0.5分鐘。',table,['G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('同終點，以 1/t 比較，60秒和30秒的相對速率相差2倍。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('第2組的相對速率是第1組的0.5倍。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('第2組的相對速率是第1組的2倍。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('以 1/t 比較，兩組速率相差3倍。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('建議再測 35°C、0.30 mol/L 的條件。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
});

it('保留建議前的觀察值、核對前後者與同單位的具名欄位',()=>{
 expect(verifyExampleRows('第1組記錄30秒並建議再做補測。',table,['G1-M4'],[])).toBeDefined();
 expect(verifyExampleRows('兩組相差99秒。',table,['G1-M4'],[])).toBeDefined();
 expect(verifyExampleRows('0.10 mol/L和0.20 mol/L組都在25°C下，前者30秒後者60秒。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('0.10 mol/L和0.20 mol/L組都在25°C下，前者60秒後者30秒。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
 const row='| A | 30 | 60 |';
 const dualTime=numericTable('| 組別 | 加熱時間(s) | 冷卻時間(s) |\n|---|---|---|\n'+row,[{id:'A',text:row}]);
 expect(verifyExampleRows('A組加熱時間60秒。',dualTime,['A'],[])).toBeDefined();
 expect(verifyExampleRows('A組冷卻時間60秒。',dualTime,['A'],[])).toBeUndefined();
});

it('兩列分別列值、平均與比某組快的方向可重算',()=>{
 expect(verifyExampleRows('編號1與編號2分別為60秒與30秒。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('編號1與編號2分別為30秒與60秒。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('兩組平均99秒。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('兩組平均45秒。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
 expect(verifyExampleRows('第1組比第2組快2倍。',table,['G1-M4','G1-M5'],[])).toBeDefined();
 expect(verifyExampleRows('第2組比第1組快2倍。',table,['G1-M4','G1-M5'],[])).toBeUndefined();
});

it('單位共用的重複量測逐值核對，不能重複借用同一個數值',()=>{
 const row='| 5 | 30, 30, 32 |';
 const table=numericTable('| 編號 | 達門檻時間 (s) |\n|---|---|\n'+row,[{id:'M5',text:row}]);
 expect(verifyExampleRows('紀錄5每次測得30、30、32秒。',table,['M5'],[])).toBeUndefined();
 expect(verifyExampleRows('紀錄5每次測得30、30、30秒。',table,['M5'],[])).toBeDefined();
});
