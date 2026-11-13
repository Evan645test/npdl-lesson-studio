// R43：核心活動或逐節教案中，同一節任務若同時涵蓋多類高負擔活動，只提醒、不阻擋。
const LOAD_GROUPS = [
  { label: '撰寫', pattern: /撰寫|寫報告/u },
  { label: '發表', pattern: /發表|展示/u },
  { label: '修改', pattern: /修改|修訂|修正/u },
] as const;

export function activityPeriodLoadNotice(text: string): string | null {
  const matched = LOAD_GROUPS.filter(row => row.pattern.test(text)).map(row => row.label);
  if (matched.length < 2) return null;
  return `這一節同時要做 ${matched.join('、')}，時間可能不夠，建議拆成兩節或刪減。`;
}
