import { useId } from 'react';
import { dataTable } from '../documents/paperLayout';

// 與文件匯出共用辨識規則；不確定欄列時保留原文，避免誤改資料。
export function AssessmentData({ text, label }: { text: string; label: string }) {
  const hintId = useId();
  const table = dataTable(text);
  if (!table) return <div className="data sp-assessment-text">{text}</div>;
  return <div className="sp-assessment-data">
    <p id={hintId} className="note sp-table-hint">表格超出畫面時，可左右滑動；鍵盤可聚焦表格後使用方向鍵。</p>
    <div className="sp-table-scroll" role="region" aria-label={label} aria-describedby={hintId} tabIndex={0}>
      <table>
        <caption>{label}</caption>
        <thead><tr>{table.headers.map((header, index) => <th scope="col" key={index}>{header}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>
          {row.map((cell, column) => column === 0 ? <th scope="row" key={column}>{cell}</th> : <td key={column}>{cell}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

