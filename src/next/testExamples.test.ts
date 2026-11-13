import { describe, expect, it } from 'vitest';
import { TEST_EXAMPLES } from './testExamples';
import { emptySingleDraft, validateStart } from './singlePath';
import { curriculum } from '../components/labels';

describe('R12-r6 測試資料', () => {
  it('每組都是有效的五項起點，學科在固定課綱中', () => {
    for (const example of TEST_EXAMPLES) {
      expect(curriculum.some(row => row.subject === example.subject)).toBe(true);
      expect(() => validateStart({ ...emptySingleDraft(), grade: example.grade, subject: example.subject, topic: example.topic, title: example.title, keywords: example.keywords })).not.toThrow();
    }
  });
});
