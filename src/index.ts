import type { Env, EmployeeRow, LeaveRow } from './lib/db';
import {
  getSetting,
  setSetting,
  getEmployeeByIdentifier,
  serializeEmployee,
  serializeRequest,
  isAdmin,
} from './lib/db';
import { json, parseCookies, cookieHeader, readJson } from './lib/http';
import { verifyPassword, hashPassword, newToken } from './lib/auth';
import { LEAVE_TYPES, countBusinessDays } from './lib/leave';
import { exportEmployeesXlsx, importEmployeesXlsx } from './lib/xlsx-helper';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname.startsWith('/api/')) {
        const res = await routeApi(request, env, url, pathname, method);
        if (res) return res;
        return json({ error: 'Not found' }, 404);
      }
      // Everything else is a static asset (the public/ directory, deployed as Worker assets).
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal server error: ' + (err as Error).message }, 500);
    }
  },
};

async function routeApi(
  request: Request,
  env: Env,
  url: URL,
  pathname: string,
  method: string
): Promise<Response | null> {
  const { DB } = env;

  // ---------------- public ----------------
  if (pathname === '/api/branding' && method === 'GET') {
    const [appName, appIcon, companyName] = await Promise.all([
      getSetting(DB, 'app_name', 'DLI HR Assistant'),
      getSetting(DB, 'app_icon', '🏢'),
      getSetting(DB, 'company_name', 'DLI'),
    ]);
    return json({ appName, appIcon, companyName });
  }

  if (pathname === '/api/employee/lookup' && method === 'POST') {
    const body = await readJson<{ identifier?: string }>(request);
    const emp = await getEmployeeByIdentifier(DB, body.identifier);
    if (!emp) return json({ error: 'Employee not found. Please check your Employee ID or email.' }, 404);
    return json({ employee: serializeEmployee(emp) });
  }

  if (pathname === '/api/employee/leaves' && method === 'GET') {
    const identifier = url.searchParams.get('identifier');
    const emp = await getEmployeeByIdentifier(DB, identifier);
    if (!emp) return json({ error: 'Employee not found' }, 404);
    const { results } = await DB.prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY applied_at DESC')
      .bind(emp.employee_id)
      .all<LeaveRow>();
    return json({ leaves: (results || []).map(serializeRequest) });
  }

  if (pathname === '/api/employee/apply' && method === 'POST') {
    const body = await readJson<{
      identifier?: string;
      leaveType?: string;
      startDate?: string;
      endDate?: string;
      reason?: string;
    }>(request);

    const emp = await getEmployeeByIdentifier(DB, body.identifier);
    if (!emp) return json({ error: 'Employee not found' }, 404);

    const leaveType = (body.leaveType || '').toLowerCase();
    const typeInfo = LEAVE_TYPES[leaveType];
    if (!typeInfo) return json({ error: 'Invalid leave type' }, 400);

    const { startDate, endDate, reason } = body;
    if (!startDate || !endDate) return json({ error: 'Start and end date are required' }, 400);

    const days = countBusinessDays(startDate, endDate);
    if (days === null || days <= 0) {
      return json({ error: 'Invalid date range (end date must be on/after start date)' }, 400);
    }

    const balanceField = typeInfo.balanceField as keyof EmployeeRow | null;
    if (balanceField) {
      const available = emp[balanceField] as number;
      if (days > available) {
        return json(
          { error: `Insufficient ${typeInfo.label} balance. You have ${available} day(s) available but requested ${days}.` },
          400
        );
      }
    }

    const overlap = await DB.prepare(
      `SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('Pending','Approved')
       AND NOT (end_date < ? OR start_date > ?)`
    )
      .bind(emp.employee_id, startDate, endDate)
      .first();
    if (overlap) {
      return json({ error: 'You already have a leave request that overlaps these dates.' }, 400);
    }

    const inserted = await DB.prepare(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending') RETURNING *`
    )
      .bind(emp.employee_id, leaveType, startDate, endDate, days, reason || '')
      .first<LeaveRow>();

    return json(
      {
        request: serializeRequest(inserted as LeaveRow),
        message: `Leave request submitted (${days} day(s)). Awaiting HR approval.`,
      },
      201
    );
  }

  // ---------------- admin: auth ----------------
  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readJson<{ password?: string }>(request);
    const hash = await getSetting(DB, 'admin_password_hash');
    const ok = await verifyPassword(body.password || '', hash);
    if (!ok) return json({ error: 'Incorrect password' }, 401);

    const token = newToken();
    const maxAge = 12 * 60 * 60;
    const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
    await DB.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').bind(token, expiresAt).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('admin_session', token, maxAge) });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    const cookies = parseCookies(request);
    if (cookies.admin_session) {
      await DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(cookies.admin_session).run();
    }
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('admin_session', '', 0) });
  }

  if (pathname === '/api/admin/session' && method === 'GET') {
    const cookies = parseCookies(request);
    const loggedIn = await isAdmin(DB, cookies);
    return json({ loggedIn });
  }

  // everything below requires an authenticated admin session
  if (pathname.startsWith('/api/admin/')) {
    const cookies = parseCookies(request);
    const ok = await isAdmin(DB, cookies);
    if (!ok) return json({ error: 'Not authenticated' }, 401);
  }

  if (pathname === '/api/admin/change-password' && method === 'POST') {
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(request);
    const hash = await getSetting(DB, 'admin_password_hash');
    const ok = await verifyPassword(body.currentPassword || '', hash);
    if (!ok) return json({ error: 'Current password is incorrect' }, 401);
    if (!body.newPassword || body.newPassword.length < 6) {
      return json({ error: 'New password must be at least 6 characters' }, 400);
    }
    await setSetting(DB, 'admin_password_hash', await hashPassword(body.newPassword));
    return json({ ok: true });
  }

  if (pathname === '/api/admin/branding' && method === 'POST') {
    const body = await readJson<{ appName?: string; appIcon?: string; companyName?: string }>(request);
    if (body.appName) await setSetting(DB, 'app_name', body.appName);
    if (body.appIcon) await setSetting(DB, 'app_icon', body.appIcon);
    if (body.companyName) await setSetting(DB, 'company_name', body.companyName);
    const [appName, appIcon, companyName] = await Promise.all([
      getSetting(DB, 'app_name'),
      getSetting(DB, 'app_icon'),
      getSetting(DB, 'company_name'),
    ]);
    return json({ appName, appIcon, companyName });
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    const [totalEmployees, pending, approved, rejected] = await Promise.all([
      DB.prepare('SELECT COUNT(*) c FROM employees').first<{ c: number }>(),
      DB.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='Pending'").first<{ c: number }>(),
      DB.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='Approved'").first<{ c: number }>(),
      DB.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='Rejected'").first<{ c: number }>(),
    ]);
    return json({
      totalEmployees: totalEmployees?.c ?? 0,
      pending: pending?.c ?? 0,
      approved: approved?.c ?? 0,
      rejected: rejected?.c ?? 0,
    });
  }

  // ---- employees export / import (static paths — check before the dynamic /employees/:id route) ----
  if (pathname === '/api/admin/employees/export/xlsx' && method === 'GET') {
    const { results } = await DB.prepare('SELECT * FROM employees ORDER BY name').all<EmployeeRow>();
    const buffer = exportEmployeesXlsx(results || []);
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="DLI_Employees.xlsx"',
      },
    });
  }

  if (pathname === '/api/admin/employees/import/xlsx' && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return json({ error: 'Expected multipart/form-data upload' }, 400);
    }
    let file: File | null = null;
    try {
      const formData = await request.formData();
      const f = formData.get('file');
      if (f instanceof File) file = f;
    } catch (e) {
      return json({ error: 'Failed to parse upload: ' + (e as Error).message }, 400);
    }
    if (!file) return json({ error: 'No file uploaded (expected field name "file")' }, 400);

    let parsed;
    try {
      const buffer = await file.arrayBuffer();
      parsed = importEmployeesXlsx(buffer);
    } catch (e) {
      return json({ error: 'Failed to process Excel file: ' + (e as Error).message }, 500);
    }

    const { employees, errors } = parsed;
    let imported = 0;
    for (const e of employees) {
      await DB.prepare(
        `INSERT INTO employees (employee_id, name, email, department, designation, join_date, annual_balance, sick_balance, casual_balance, unpaid_balance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(employee_id) DO UPDATE SET
           name=excluded.name, email=excluded.email, department=excluded.department,
           designation=excluded.designation, join_date=excluded.join_date,
           annual_balance=excluded.annual_balance, sick_balance=excluded.sick_balance,
           casual_balance=excluded.casual_balance, unpaid_balance=excluded.unpaid_balance,
           updated_at=datetime('now')`
      )
        .bind(
          e.employee_id,
          e.name,
          e.email,
          e.department,
          e.designation,
          e.join_date,
          e.annual_balance,
          e.sick_balance,
          e.casual_balance,
          e.unpaid_balance
        )
        .run();
      imported++;
    }
    return json({ ok: true, imported, errors });
  }

  // ---- employees list / add ----
  if (pathname === '/api/admin/employees' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    let results: EmployeeRow[];
    if (q) {
      const like = `%${q}%`;
      const res = await DB.prepare(
        `SELECT * FROM employees WHERE employee_id LIKE ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE
         OR email LIKE ? COLLATE NOCASE OR department LIKE ? COLLATE NOCASE ORDER BY name`
      )
        .bind(like, like, like, like)
        .all<EmployeeRow>();
      results = res.results || [];
    } else {
      const res = await DB.prepare('SELECT * FROM employees ORDER BY name').all<EmployeeRow>();
      results = res.results || [];
    }
    return json({ employees: results.map(serializeEmployee) });
  }

  if (pathname === '/api/admin/employees' && method === 'POST') {
    const body = await readJson<{
      employeeId?: string;
      name?: string;
      email?: string;
      department?: string;
      designation?: string;
      joinDate?: string;
      annual?: number | string;
      sick?: number | string;
      casual?: number | string;
      unpaid?: number | string;
    }>(request);

    const employeeId = (body.employeeId || '').trim();
    const name = (body.name || '').trim();
    if (!employeeId || !name) return json({ error: 'Employee ID and Name are required' }, 400);

    try {
      await DB.prepare(
        `INSERT INTO employees (employee_id, name, email, department, designation, join_date, annual_balance, sick_balance, casual_balance, unpaid_balance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          employeeId,
          name,
          body.email || '',
          body.department || '',
          body.designation || '',
          body.joinDate || '',
          Number(body.annual ?? 21),
          Number(body.sick ?? 10),
          Number(body.casual ?? 7),
          Number(body.unpaid ?? 0)
        )
        .run();
    } catch (e) {
      return json({ error: 'Employee ID already exists' }, 400);
    }

    const emp = await DB.prepare('SELECT * FROM employees WHERE employee_id = ?').bind(employeeId).first<EmployeeRow>();
    return json({ employee: serializeEmployee(emp as EmployeeRow) }, 201);
  }

  // ---- single employee: GET / PUT / DELETE ----
  const empMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)$/);
  if (empMatch) {
    const empId = decodeURIComponent(empMatch[1]);

    if (method === 'GET') {
      const emp = await DB.prepare('SELECT * FROM employees WHERE employee_id = ?').bind(empId).first<EmployeeRow>();
      if (!emp) return json({ error: 'Employee not found' }, 404);
      const { results } = await DB.prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY applied_at DESC')
        .bind(empId)
        .all<LeaveRow>();
      return json({ employee: serializeEmployee(emp), leaves: (results || []).map(serializeRequest) });
    }

    if (method === 'PUT') {
      const emp = await DB.prepare('SELECT * FROM employees WHERE employee_id = ?').bind(empId).first<EmployeeRow>();
      if (!emp) return json({ error: 'Employee not found' }, 404);
      const body = await readJson<{
        name?: string;
        email?: string;
        department?: string;
        designation?: string;
        joinDate?: string;
        annual?: number | string;
        sick?: number | string;
        casual?: number | string;
        unpaid?: number | string;
      }>(request);

      await DB.prepare(
        `UPDATE employees SET name=?, email=?, department=?, designation=?, join_date=?,
         annual_balance=?, sick_balance=?, casual_balance=?, unpaid_balance=?, updated_at=datetime('now')
         WHERE employee_id = ?`
      )
        .bind(
          body.name ?? emp.name,
          body.email ?? emp.email,
          body.department ?? emp.department,
          body.designation ?? emp.designation,
          body.joinDate ?? emp.join_date,
          body.annual !== undefined ? Number(body.annual) : emp.annual_balance,
          body.sick !== undefined ? Number(body.sick) : emp.sick_balance,
          body.casual !== undefined ? Number(body.casual) : emp.casual_balance,
          body.unpaid !== undefined ? Number(body.unpaid) : emp.unpaid_balance,
          empId
        )
        .run();

      const updated = await DB.prepare('SELECT * FROM employees WHERE employee_id = ?').bind(empId).first<EmployeeRow>();
      return json({ employee: serializeEmployee(updated as EmployeeRow) });
    }

    if (method === 'DELETE') {
      await DB.prepare('DELETE FROM employees WHERE employee_id = ?').bind(empId).run();
      await DB.prepare('DELETE FROM leave_requests WHERE employee_id = ?').bind(empId).run();
      return json({ ok: true });
    }
  }

  // ---- leave requests: list ----
  if (pathname === '/api/admin/leaves' && method === 'GET') {
    const status = url.searchParams.get('status');
    const query = status
      ? DB.prepare(
          `SELECT lr.*, e.name as emp_name FROM leave_requests lr
           JOIN employees e ON e.employee_id = lr.employee_id
           WHERE lr.status = ? ORDER BY lr.applied_at DESC`
        ).bind(status)
      : DB.prepare(
          `SELECT lr.*, e.name as emp_name FROM leave_requests lr
           JOIN employees e ON e.employee_id = lr.employee_id
           ORDER BY lr.applied_at DESC`
        );
    const { results } = await query.all<LeaveRow & { emp_name: string }>();
    return json({
      leaves: (results || []).map((r) => ({ ...serializeRequest(r), employeeName: r.emp_name })),
    });
  }

  // ---- leave requests: approve / reject ----
  const decideMatch = pathname.match(/^\/api\/admin\/leaves\/(\d+)\/decide$/);
  if (decideMatch && method === 'POST') {
    const id = Number(decideMatch[1]);
    const body = await readJson<{ decision?: 'Approved' | 'Rejected'; note?: string }>(request);
    const decision = body.decision;
    if (decision !== 'Approved' && decision !== 'Rejected') return json({ error: 'Invalid decision' }, 400);

    const reqRow = await DB.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(id).first<LeaveRow>();
    if (!reqRow) return json({ error: 'Leave request not found' }, 404);
    if (reqRow.status !== 'Pending') return json({ error: `Request already ${reqRow.status}` }, 400);

    if (decision === 'Approved') {
      const balanceField = LEAVE_TYPES[reqRow.leave_type]?.balanceField;
      if (balanceField) {
        const emp = await DB.prepare('SELECT * FROM employees WHERE employee_id = ?')
          .bind(reqRow.employee_id)
          .first<EmployeeRow>();
        const available = emp ? (emp as unknown as Record<string, number>)[balanceField] : 0;
        if (available < reqRow.days) {
          return json({ error: 'Employee no longer has sufficient balance for this request.' }, 400);
        }
        await DB.prepare(
          `UPDATE employees SET ${balanceField} = ${balanceField} - ?, updated_at=datetime('now') WHERE employee_id = ?`
        )
          .bind(reqRow.days, reqRow.employee_id)
          .run();
      }
    }

    await DB.prepare(`UPDATE leave_requests SET status=?, decided_at=datetime('now'), decided_by='admin', admin_note=? WHERE id = ?`)
      .bind(decision, body.note || '', id)
      .run();

    const updated = await DB.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(id).first<LeaveRow>();
    return json({ request: serializeRequest(updated as LeaveRow) });
  }

  return null;
}
