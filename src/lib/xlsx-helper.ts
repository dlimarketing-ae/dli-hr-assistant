// Excel import/export using SheetJS (the "xlsx" npm package), which is pure
// JS and runs fine in the Cloudflare Workers/Pages Functions runtime — this
// replaces the Python/openpyxl helper used in the Node.js version of this app.
import * as XLSX from 'xlsx';
import type { EmployeeRow } from './db';

const HEADERS: Array<[key: string, label: string]> = [
  ['employee_id', 'Employee ID'],
  ['name', 'Name'],
  ['email', 'Email'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['join_date', 'Join Date'],
  ['annual_balance', 'Annual Leave Balance'],
  ['sick_balance', 'Sick Leave Balance'],
  ['casual_balance', 'Casual Leave Balance'],
  ['unpaid_balance', 'Unpaid Leave Taken'],
];

export function exportEmployeesXlsx(employees: EmployeeRow[]): ArrayBuffer {
  const rows = employees.map((e) => {
    const obj: Record<string, unknown> = {};
    for (const [key, label] of HEADERS) {
      obj[label] = (e as unknown as Record<string, unknown>)[key] ?? '';
    }
    return obj;
  });
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS.map(([, label]) => label) }) as Record<
    string,
    unknown
  >;
  worksheet['!cols'] = [14, 22, 28, 18, 20, 14, 14, 12, 14, 14].map((wch) => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Employees');
  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

function normKey(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const HEADER_ALIASES: Record<string, string> = {
  employee_id: 'employee_id', employeeid: 'employee_id', emp_id: 'employee_id', id: 'employee_id',
  name: 'name', employee_name: 'name', full_name: 'name',
  email: 'email', email_address: 'email',
  department: 'department', dept: 'department',
  designation: 'designation', title: 'designation', role: 'designation', position: 'designation',
  join_date: 'join_date', joining_date: 'join_date', date_of_joining: 'join_date', doj: 'join_date',
  annual_leave_balance: 'annual_balance', annual_balance: 'annual_balance', annual_leave: 'annual_balance', vacation_balance: 'annual_balance',
  sick_leave_balance: 'sick_balance', sick_balance: 'sick_balance', sick_leave: 'sick_balance',
  casual_leave_balance: 'casual_balance', casual_balance: 'casual_balance', casual_leave: 'casual_balance',
  unpaid_leave_taken: 'unpaid_balance', unpaid_balance: 'unpaid_balance', unpaid_leave: 'unpaid_balance',
};

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function cellNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

export type ImportedEmployee = {
  employee_id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  join_date: string;
  annual_balance: number;
  sick_balance: number;
  casual_balance: number;
  unpaid_balance: number;
};

export function importEmployeesXlsx(buffer: ArrayBuffer): { employees: ImportedEmployee[]; errors: string[] } {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });

  const errors: string[] = [];
  const employees: ImportedEmployee[] = [];

  if (!rows.length) {
    return { employees: [], errors: ['Sheet is empty'] };
  }

  const headerRow = rows[0];
  const colMap = new Map<number, string>();
  headerRow.forEach((h, idx) => {
    const norm = normKey(h);
    const canon = HEADER_ALIASES[norm];
    if (canon) colMap.set(idx, canon);
  });

  const foundKeys = new Set(colMap.values());
  if (!foundKeys.has('employee_id') || !foundKeys.has('name')) {
    errors.push(
      "Could not find required 'Employee ID' and 'Name' columns in header row. Found headers: " +
        headerRow.map((h) => String(h ?? '')).join(', ')
    );
    return { employees: [], errors };
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => v === null || v === undefined || String(v).trim() === '')) continue;

    const rec: Record<string, unknown> = {};
    for (const [idx, canon] of colMap.entries()) {
      const val = row[idx];
      rec[canon] = canon.endsWith('_balance') ? cellNum(val, 0) : cellStr(val);
    }

    if (!rec.employee_id || !rec.name) {
      errors.push(`Row ${r + 1}: missing Employee ID or Name, skipped`);
      continue;
    }

    employees.push({
      employee_id: String(rec.employee_id),
      name: String(rec.name),
      email: String(rec.email ?? ''),
      department: String(rec.department ?? ''),
      designation: String(rec.designation ?? ''),
      join_date: String(rec.join_date ?? ''),
      annual_balance: (rec.annual_balance as number) ?? 21,
      sick_balance: (rec.sick_balance as number) ?? 10,
      casual_balance: (rec.casual_balance as number) ?? 7,
      unpaid_balance: (rec.unpaid_balance as number) ?? 0,
    });
  }

  return { employees, errors };
}
