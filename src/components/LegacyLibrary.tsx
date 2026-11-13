import type { LegacyImport } from '../domain/types';

export function LegacyLibrary({ imports, onDownload }: { imports: LegacyImport[]; onDownload: (item: LegacyImport) => void }) {
  return <details className="card legacy-library">
    <summary>舊備份原始副本（{imports.length}）</summary>
    <p>原評量工作區及原課程專案只作唯讀來源。題目、規準、來源與已施測紀錄保留在原 JSON；尚未對應新版規準或題型，也不能直接比較或換算舊結果。請先核對原資料，再以新版流程建立設計。</p>
    {!imports.length && <p className="note">可使用上方「轉入備份副本」選擇舊版 JSON。含學生證據或憑證欄位的檔案會拒絕轉入。</p>}
    {imports.map(item => <section className="reference" key={item.id}>
      <h3>{item.title}</h3>
      <p>{item.kind === 'assessment-studio' ? '原評量工作區' : '原課程專案'}・版本 {item.sourceVersion}・待教師核對</p>
      <p className="note">原檔：{item.filename}；SHA-256：<code>{item.sha256}</code></p>
      <button type="button" onClick={() => onDownload(item)}>下載這份原始備份</button>
    </section>)}
  </details>;
}
