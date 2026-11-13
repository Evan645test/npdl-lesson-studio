// Keep originals for evidence. Only a secondary reading aid standardizes explicit clock notation.
export function clockAid(value: string): string {
  return value.replace(/(清晨|凌晨|上午|中午|下午|傍晚|晚上|晚間|早上)\s*(\d{1,2})\s*(?:點|時)(?:\s*(\d{1,2})\s*分)?/gu,
    (original, period: string, hourText: string, minuteText: string | undefined, offset: number, input: string) => {
      let hour = Number(hourText), minute = Number(minuteText ?? '0');
      const tail = input.slice(offset + original.length);
      if (hour < 1 || hour >= 12 || minute > 59 || /^\s*(?:半|一刻|三刻|[0-9]|分|秒|至|到|[–—-])/u.test(tail)) return original;
      if (/下午|傍晚|晚上|晚間/.test(period) && hour < 12) hour += 12;
      if (period === '中午' && hour !== 12) return original;
      return String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0');
    });
}
