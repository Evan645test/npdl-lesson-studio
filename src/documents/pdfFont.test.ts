import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { drawPdfText, installPdfFont, parseCanvasFont, toBase64 } from './pdfFont';

it('R31 從畫布字型字串取字級與粗細',()=>{
 expect(parseCanvasFont('700 28px "NPDL Noto Sans TC", sans-serif')).toEqual({sizePx:28,bold:true});
 expect(parseCanvasFont('400 22px sans-serif')).toEqual({sizePx:22,bold:false});
 expect(parseCanvasFont('18px sans-serif')).toEqual({sizePx:18,bold:false});
});
it('R31 嵌入本機字型子集：中文文字寫進 PDF 而不是影像，檔案只含用到的字形',()=>{
 const font=toBase64(new Uint8Array(readFileSync('public/fonts/NotoSansTC.ttf')));
 const pdf=new jsPDF({unit:'mm',format:'a4',compress:false});
 installPdfFont(pdf,font);
 drawPdfText(pdf,{text:'實驗編號 2，25°C，30 秒',x:90,y:105,sizePx:22,color:'#1f2927',bold:false,align:'left',baseline:'top'});
 drawPdfText(pdf,{text:'第 1 組判讀',x:90,y:150,sizePx:28,color:'#164b45',bold:true,align:'left',baseline:'top'});
 drawPdfText(pdf,{text:'不可見文字層',x:90,y:200,sizePx:18,color:'#000000',bold:false,align:'left',baseline:'top'},true);
 const out=pdf.output();
 expect(out).toContain('/FontFile2');
 expect(out).toContain('/ToUnicode');
 expect(out).not.toContain('/Subtype /Image');
 expect(out).toMatch(/\b3 Tr\b/);
 expect(out.length).toBeLessThan(400_000);
});
