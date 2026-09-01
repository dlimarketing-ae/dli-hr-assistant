// Thin helpers around the D1 binding to keep route handlers concise.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type EmployeeRow = {
  id: number;
  employee_id: string;
  name: string;
  email: string | null;
  department: string | null;
  designation: string | null;
  join_date: string | null;
  annual_balance: number;
  sick_balance: number;
  casual_balance: number;
  unpaid_balance: number;
  created_at: string;
  updated_at: string;
};

export type LeaveRow = {
  id: number;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  applied_at: string;
  decided_at: string | null;
  decided_by: string | null;
  admin_note: string | null;
};

export async function getSetting(db: D1Database, key: string, fallback: string | null = null): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? row.value : fallback;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, value)
    .run();
}

export async function getEmployeeByIdentifier(db: D1Database, identifier: string | null | undefined): Promise<EmployeeRow | null> {
  const id = (identifier || '').trim();
  if (!id) return null;
  const row = await db
    .prepare('SELECT * FROM employees WHERE employee_id = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
    .bind(id, id)
    .first<EmployeeRow>();
  return row || null;
}

export function serializeEmployee(e: EmployeeRow) {
  return {
    employeeId: e.employee_id,
    name: e.name,
    email: e.email,
    department: e.department,
    designation: e.designation,
    joinDate: e.join_date,
    balances: {
      annual: e.annual_balance,
      sick: e.sick_balance,
      casual: e.casual_balance,
      unpaid: e.unpaid_balance,
    },
  };
}

export function serializeRequest(r: LeaveRow) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.days,
    reason: r.reason,
    status: r.status,
    appliedAt: r.applied_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    adminNote: r.admin_note,
  };
}

export async function isAdmin(db: D1Database, cookies: Record<string, string>): Promise<boolean> {
  const token = cookies.admin_session;
  if (!token) return false;
  const row = await db
    .prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first();
  return !!row;
}
