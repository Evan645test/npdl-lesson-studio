import { strategiesFor } from './assessmentStrategy';
import type { AssessmentBlueprintSelection, DesignVersion } from './types';

export function describePaperAssessment(design: DesignVersion, selection: AssessmentBlueprintSelection): string {
  const strategy = strategiesFor(design.inputSnapshot.subject).find(row => row.id === selection.strategyId);
  const index = design.activities.findIndex(row => row.id === selection.postActivityId);
  const anchor = index < 0 ? '單元主情境「' + design.inputSnapshot.title + '」' : `第 ${index + 1} 節「${design.activities[index].name}」`;
  return `出題策略：${strategy?.label ?? selection.strategyId}；後測情境：${anchor}。`;
}
