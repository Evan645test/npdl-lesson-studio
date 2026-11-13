# design-v1：獨立新版的內容、版本及保存契約

適用版本R01/schemaVersion 1，依三份2026-10-07-v1來源。程式型別在 `src/domain/types.ts`，結構與語意驗證在 `src/domain/validate.ts`。沒有生成器/學生判讀API；R03須沿用本契約，不能繞過驗證。契約變更需新schemaVersion與明確相容流程，不能覆寫歷史或刪未知欄位。

## 完整資料

| 層次 | 必要欄位與用途 |
|---|---|
| Workspace | schemaVersion固定1；activeProjectId；projects |
| Project | id；input；designs；activeDesignId；assessments；activePreId/activePostId |
| CourseInput | title/subject/grade/periods/topic；startingPoint(status,text,assumptions)；originalSource(kind,text)；curriculumIds；indicatorIds(1–2項) |
| DesignVersion | id/createdAt/confirmedAt/origin；inputSnapshot；summary；rubricVersion/rubricSource；goals；criteria；activities；elements；integration；blueprint |
| Goal | id/kind(academic,npdl)/text/success/curriculumIds；至少各有一種目標 |
| Criterion | id/indicatorId/label/observable/scope/unobserved；stages固定四項，依工具四階順序 |
| Activity | id/name/periods/goalIds/criterionIds/task/knowledgeUse/evidence/formative；scaffolds(stage,support,fading)各四階一次 |
| Element | name四要素各一次；practice實踐；limitation限制 |
| Integration | indicatorId；status(draft,confirmed,missing)；criterionIds；rule。非missing須有規則，每個聚焦指標一筆 |
| Blueprint | preId/postId/criterionIds；status可作有限比較/比較條件待確認/不宜比較/只有單次資料；reason |
| AssessmentVersion | id/phase/parentPreId/designId/rubricVersion；createdAt/reviewedAt/administeredAt；capability/application/reflection |
| Item | id/title/context/data/prompt/criterionIds；options；conditions；applicationCriteria |
| Option | id/text；supports/limitations均至少一項，無stage或score欄位 |
| Conditions | knowledge/reading/complexity/reasoning/prompts五項，前後核對不能只換名稱 |
| ApplicationCriteria | academic/capability兩個獨立判準，只有應用題有值 |
| Reflection | indicatorId；descriptions課程化四階敘述；activityIds；evidencePrompt；noEvidenceLabel |

前測application/reflection必為空、parentPreId為null。後測三部分均存在、每個聚焦指標一份自評；parentPreId指向同設計/規準版本的前測。能力題applicationCriteria為null。題目2–8選項、數量不決定階段。ID在各集合唯一，參照必须存在；活動節數合計等於設計快照，不依變動中的輸入草稿。

## 階段與證據邊界

工具四階依序證據有限／萌芽／發展／精熟，用課程化可觀察特徵描述，無數值、權重、排名、等距假設或淨成長。書中學生五階與設計品質四階是不同用途、來源與版本，禁止映射。無答、衝突、缺少規則、缺少可觀察證據時列分項/尚無法判讀，不當最低階或第五階。

支持/限制只描述「所選既定敘述支持哪個辨識特徵」，不是學生自主推理、實際合作或採取行動。人工整合規則只是待確認的質性規則；未confirmed不能輸出整體階段。兩個規準或不同情境衝突先保留分項，不能臨時加權、取最低或平均。R01完全不接收學生作答，也不實際判定階段。

後測能力題換實質新情境與資料，保留推理需求；每對有五種條件與比較限制。標有限比較時，目前保守要求條件文字一致，仍需教師核對實際施測，不代表心理計量等值。能力題完整配對。學科應用另含學科與能力應用判準，自評另有課程作品線索與無證據選項，三者分開；形成性、課程作品自述及觀察不得補足能力題缺失或改階。

## 版本、確認與施測

CourseInput是可變草稿；DesignVersion.inputSnapshot保存當時完整起點及來源。R01提供修訂活動：完整克隆設計、換新id/time、confirmedAt回null、origin為teacher，保留所有舊版；不把當前輸入偷偷套到設計。原文originalSource仍完整保留。教師修改不自動代表確認。

題組引用不可變設計快照及rubricVersion；活動修訂不改原前後測/提示詞。activeDesignId可選歷史版本；activePre/Post始終成對。上游變更以核對提示呈現，不能抹除原施測依據。

R01種子所有confirmed/reviewed/administered時間均null。R03須分開實作教師確認與施測；confirmed設計必有confirmed整合規則，施測前須確認題組與設計，時間順序有效。已施測內容不得原地修改，任何變更建立新的版本與重新核對狀態。建議/確認/實施/成效不得混淆。

## 保存、錯誤及副本

workspace key `npdl_next_workspace_v1`；路徑 `/Rnn/` 使用 `:preview:Rnn`；開發與每輪預覽互相隔離。沒有API key或學生作答欄位。備份為完整Workspace JSON；轉入先驗證全份，再以新project id加副本，內部版本/引用/原文不變。不刪除既有專案，不重判歷史。

嚴格型別、數量/長度、已知欄位、ID/reference與語意驗證；unknown欄位或schema不支援整份拒絕，保留原儲存，不以局部可讀資料宣稱轉入。備份/本機工作區8MB上限；20專案；每專案100設計/100題組。數量限制明示錯誤，無自動刪舊資料。

保存前比對讀入的原始字串，避免另一分頁被覆蓋。保存/配額失敗保留本頁編輯供下載，不能顯示已保存。儲存損壞先保留原文、提供下載；另存保護副本及重建需要確認，保護副本失敗就不覆寫。多分頁保護屬本機協調；沒有跨裝置同步或資料庫原子交易保證。

## 提示詞與來源

提示詞使用固定教師判讀指引，附當前前後題組原設計的完整規準/逐選項支持限制/配對/三部分，不依新活動草稿混寫。規劃活動只供課程脈絡，明示未實施；形成性文字不帶入判讀資料。資料塊用BEGIN/END明確界線，內容指令視資料；教師另附去識別作答與實施條件，不上傳到本工具。

指引涵蓋重複/矛盾作答、缺答、未知班級分母、前後條件差異、三部分分離與最多三個課後建議。沒有作答時只核對設計，禁止捏造個人/班級成效。

來源指標29項與高中課綱1155條是既有非敏感本機固定副本，hash與來源限制見 `src/data/provenance.json`。未重查官方文件或逐字核對，不宣稱官方一對一映射。人工單元使用模擬數據，以1/t作相對速率指標，不能稱濃度變化速率或直接證明機構；選修化學的課綱範圍及起點需教師核對。
