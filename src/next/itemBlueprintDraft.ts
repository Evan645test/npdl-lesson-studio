import { effectiveModes } from './ModePicker';
import { readItemBlueprintDraft } from '../domain/itemBlueprint';
import { strategiesFor } from '../domain/assessmentStrategy';
import type { ModeChoice } from '../domain/thresholdSet';
import type { AssessmentBlueprintSelection, DesignVersion, ItemBlueprint, Project } from '../domain/types';

export const DRAFT_CONFIG_LIMIT = 6;
export const blueprintScope = (selection: AssessmentBlueprintSelection, modes: ModeChoice[]) =>
  JSON.stringify([selection.strategyId, selection.postActivityId, modes]);

interface DraftRecord { modeChoices: ModeChoice[] | null; paperSelection: AssessmentBlueprintSelection | null; itemDrafts: Map<string, ItemBlueprint> }
interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function restoreBlueprintDraft(store: Store, key: string, project: Project, design: DesignVersion) {
  const raw = store.getItem(key);
  if (!raw || raw.length > 160000) return undefined;
  const saved = record(JSON.parse(raw));
  if (!saved) return undefined;
  const strategyIds = strategiesFor(design.inputSnapshot.subject).map(strategy => strategy.id);
  function selection(strategyId: unknown, postActivityId: unknown): AssessmentBlueprintSelection | null {
    return typeof strategyId === 'string' && strategyIds.includes(strategyId) &&
      (postActivityId === null || typeof postActivityId === 'string' && design.activities.some(activity => activity.id === postActivityId))
      ? { strategyId, postActivityId } : null;
  }
  function modes(value: unknown): ModeChoice[] | null {
    if (!Array.isArray(value) || !value.every(row => record(row))) return null;
    const rows = (value as ModeChoice[]).map(({ indicatorId, mode, suggestedMode }) => ({ indicatorId, mode, suggestedMode }));
    const checked = effectiveModes(project, rows);
    return checked === rows ? checked : null;
  }
  const setting = record(saved.paperSelection);
  const paperSelection = selection(setting?.strategyId, setting?.postActivityId);
  const modeChoices = modes(saved.modeChoices);
  const itemDrafts = new Map<string, ItemBlueprint>();
  if (Array.isArray(saved.itemDrafts)) for (const entry of saved.itemDrafts.slice(-DRAFT_CONFIG_LIMIT)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0].length > 1000) continue;
    let scope: unknown;
    try { scope = JSON.parse(entry[0]); } catch { continue; }
    if (!Array.isArray(scope)) continue;
    const setting = selection(scope[0], scope[1]), chosen = modes(scope[2]);
    if (!setting || !chosen || chosen.every(row => row.mode === 'E')) continue;
    const draft = readItemBlueprintDraft(entry[1], chosen);
    if (draft) itemDrafts.set(blueprintScope(setting, chosen), draft);
  }
  return { paperSelection, modeChoices, itemDrafts };
}

export function storeBlueprintDraft(store: Store, key: string, data: DraftRecord): void {
  const paperSelection = data.paperSelection ? { strategyId: data.paperSelection.strategyId, postActivityId: data.paperSelection.postActivityId } : null;
  store.setItem(key, JSON.stringify({ modeChoices: data.modeChoices, paperSelection, itemDrafts: [...data.itemDrafts].slice(-DRAFT_CONFIG_LIMIT) }));
}
