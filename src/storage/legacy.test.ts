import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { validateWorkspace } from '../domain/validate';
import { createLegacyImport, inspectLegacy } from './legacy';
import { importCopies, parseBackup } from './workspace';

function assessmentBackup() {
  const input = { title: '舊化學課' };
  const plan = { rubrics: [{ id: 'r1' }] };
  const pre = { id: 'pre-old', phase: 'pre', preId: null, sourceKey: 'old-source', administeredAt: 100,
    input, plan, blocks: [{ indicatorId: 'critical-evaluate-information', cases: [{ id: 'case-old', questions: [{ id: 'q-old', prompt: '原題' }] }] }] };
  const post = { ...pre, id: 'post-old', phase: 'post', preId: 'pre-old', administeredAt: 200 };
  return { version: 1, activeId: 'old-project', projects: [{ id: 'old-project', input, versions: [pre, post] }] };
}
function courseBackup() {
  return { schemaVersion: 5, courseId: 'course-old', form: { unitName: '舊課程專案' }, selectedRecordIds: ['CAa-Ⅴa-1'],
    design: { activities: [{ id: 'activity-old', text: '原活動' }] }, assessment: { preQuestions: [{ id: 'q-old', prompt: '原題' }], workflow: { pre: { status: 'published' } } }, students: [] };
}

describe('舊備份原始副本', () => {
  it('保留原評量工作區所有版本、題組、施測時間與原始位元文字', async () => {
    const raw = JSON.stringify(assessmentBackup(), null, 2);
    const item = await createLegacyImport(raw, 'old-assessment.json');
    expect(item.kind).toBe('assessment-studio');
    expect(item.raw).toBe(raw);
    expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
    const current = createSeed();
    const withLegacy = validateWorkspace({ ...current, legacyImports: [item] });
    const restored = parseBackup(JSON.stringify(withLegacy));
    expect(restored.legacyImports?.[0].raw).toBe(raw);
    expect(JSON.parse(restored.legacyImports![0].raw).projects[0].versions[1].administeredAt).toBe(200);
    expect(restored.projects[0]).toEqual(current.projects[0]);
    const copied = importCopies(current, restored);
    expect(copied.legacyImports?.[0].raw).toBe(raw);
    expect(copied.legacyImports?.[0].id).not.toBe(item.id);
  });

  it('保留原課程設計、題組與來源，不換算新版四階', async () => {
    const raw = JSON.stringify(courseBackup());
    const item = await createLegacyImport(raw, 'course.json');
    expect(item.kind).toBe('course-workspace');
    expect(JSON.parse(item.raw).assessment.preQuestions[0].prompt).toBe('原題');
    expect(JSON.parse(item.raw).design.activities[0].text).toBe('原活動');
    expect(validateWorkspace({ ...createSeed(), legacyImports: [item] }).projects).toEqual(createSeed().projects);
  });

  it('拒絕損壞、版本不支援、失去配對、學生證據及憑證欄位', () => {
    expect(() => inspectLegacy('{broken')).toThrow('完整 JSON');
    expect(() => inspectLegacy(JSON.stringify({ ...assessmentBackup(), version: 9 }))).toThrow('不支援');
    const missingPre = assessmentBackup(); missingPre.projects[0].versions.shift();
    expect(() => inspectLegacy(JSON.stringify(missingPre))).toThrow('缺少配對前測');
    const students = { ...courseBackup(), students: [{ name: '某學生' }] };
    expect(() => inspectLegacy(JSON.stringify(students))).toThrow('含學生證據');
    const secrets = { ...courseBackup(), accessToken: 'test-token' };
    expect(() => inspectLegacy(JSON.stringify(secrets))).toThrow('憑證欄位');
  });
});
