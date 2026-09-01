export const LEAVE_TYPES: Record<string, { label: string; balanceField: string | null }> = {
  annual: { label: 'Annual Leave', balanceField: 'annual_balance' },
  sick: { label: 'Sick Leave', balanceField: 'sick_balance' },
  casual: { label: 'Casual Leave', balanceField: 'casual_balance' },
  unpaid: { label: 'Unpaid Leave', balanceField: null },
};

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 5 || day === 6; // Friday/Saturday weekend — adjust if your org differs
}

export function countBusinessDays(startStr: string, endStr: string): number | null {
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (!isWeekend(cur)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
