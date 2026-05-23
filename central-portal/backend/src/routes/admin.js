const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth, requireRole, restrictToTenant } = require('../middleware/rbac');
const { logAdminAction } = require('../utils/auditLogger');
const { sendLockAccountCallback } = require('../services/callbacks');

const router = express.Router();

// Helper to generate a random API Key
function generateApiKey() {
  return 'wk_' + crypto.randomBytes(16).toString('hex');
}

// =========================================================================
// SUPER ADMIN ONLY: Company Onboarding
// =========================================================================
router.post('/companies', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id, name, domain, callbackUrl } = req.body;
  if (!id || !name || !domain || !callbackUrl) {
    return res.status(400).json({ error: 'All fields (id, name, domain, callbackUrl) are required' });
  }

  try {
    // Check if company already exists
    const checkCompany = await db.query('SELECT id FROM companies WHERE id = $1 OR domain = $2', [id, domain]);
    if (checkCompany.rows.length > 0) {
      return res.status(409).json({ error: 'Company ID or Domain already registered.' });
    }

    const plainApiKey = generateApiKey();
    const hashedApiKey = await bcrypt.hash(plainApiKey, 10);

    // Save company
    await db.query(
      `INSERT INTO companies (id, name, domain, api_key_hash, callback_url) 
       VALUES ($1, $2, $3, $4, $5)`,
      [id, name, domain, hashedApiKey, callbackUrl]
    );

    // Create default Company Admin account
    const defaultAdminEmail = `admin@${domain}`;
    const defaultPassword = 'password123';
    const hashedAdminPassword = await bcrypt.hash(defaultPassword, 10);

    const adminInsertRes = await db.query(
      `INSERT INTO company_admins (company_id, email, password_hash, role) 
       VALUES ($1, $2, $3, 'company_admin') RETURNING id`,
      [id, defaultAdminEmail, hashedAdminPassword]
    );

    // Audit Log onboarding action
    await logAdminAction({
      companyId: null, // Global superadmin action
      adminId: req.admin.adminId,
      action: 'onboard_company',
      targetType: 'company',
      targetId: id,
      metadata: { name, domain, callbackUrl, adminEmail: defaultAdminEmail },
    });

    return res.status(201).json({
      message: 'Company onboarded successfully',
      company: {
        id,
        name,
        domain,
        callbackUrl,
      },
      apiKey: plainApiKey, // Display once
      defaultAdmin: {
        email: defaultAdminEmail,
        password: defaultPassword,
      },
    });

  } catch (error) {
    console.error('Company onboarding error:', error);
    return res.status(500).json({ error: 'Failed to onboard company' });
  }
});

// =========================================================================
// SUPER ADMIN ONLY: Sync Employee Roster
// =========================================================================
router.post('/companies/:companyId/sync-roster', requireAuth, requireRole('superadmin'), restrictToTenant, async (req, res) => {
  const { companyId } = req.params;
  const roster = req.body; // Expects JSON array: [{ external_employee_id: 1, email: "..." }]

  if (!Array.isArray(roster)) {
    return res.status(400).json({ error: 'Roster payload must be a JSON array' });
  }

  try {
    await db.query('BEGIN');

    // Delete old roster entries to re-sync
    await db.query('DELETE FROM employees WHERE company_id = $1', [companyId]);

    // Insert new roster
    for (const emp of roster) {
      await db.query(
        `INSERT INTO employees (company_id, external_employee_id, email) 
         VALUES ($1, $2, $3)`,
        [companyId, emp.external_employee_id, emp.email]
      );

      // Create a default blank behavior baseline
      await db.query(
        `INSERT INTO behavior_baselines (company_id, employee_id) 
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [companyId, emp.external_employee_id]
      );
    }

    await db.query('COMMIT');

    // Audit Log roster sync
    await logAdminAction({
      companyId: companyId,
      adminId: req.admin.adminId,
      action: 'sync_employee_roster',
      targetType: 'employees',
      targetId: companyId,
      metadata: { count: roster.length },
    });

    return res.status(200).json({ message: `Successfully synchronized ${roster.length} employee records.` });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Roster sync error:', error);
    return res.status(500).json({ error: 'Failed to synchronize roster' });
  }
});

// =========================================================================
// SUPER ADMIN ONLY: List Companies
// =========================================================================
router.get('/companies', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, domain, callback_url, created_at FROM companies ORDER BY created_at DESC');
    return res.status(200).json({ companies: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve companies' });
  }
});

// =========================================================================
// SUPER ADMIN ONLY: Get Login Events for Heatmap
// =========================================================================
router.get('/login-events', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT le.*, rs.total_score, rs.action_taken, rs.score_breakdown_json 
       FROM login_events le
       LEFT JOIN risk_scores rs ON rs.login_event_id = le.id
       WHERE le.latitude IS NOT NULL AND le.longitude IS NOT NULL
       ORDER BY le.timestamp DESC LIMIT 100`
    );
    return res.status(200).json({ loginEvents: result.rows });
  } catch (error) {
    console.error('Login events query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve login events for heatmap' });
  }
});


// =========================================================================
// SHARED: Get Dashboard Stats (Aggregated / Scoped)
// =========================================================================
router.get('/dashboard-stats', requireAuth, restrictToTenant, async (req, res) => {
  const isSuper = req.admin.role === 'superadmin';
  const companyId = req.tenantId; // Set by restrictToTenant middleware

  try {
    let queryParams = [];
    let employeeCount = 0;
    let activeSessionsCount = 0;
    let alertsCount = { critical: 0, high: 0, medium: 0, low: 0 };
    let attacksCount = 0;
    let lockedCount = 0;
    let companiesCount = 0;

    if (isSuper) {
      // Super Admin: Retrieve global details
      const compCountRes = await db.query('SELECT COUNT(*) FROM companies');
      companiesCount = parseInt(compCountRes.rows[0].count, 10);

      const empCountRes = await db.query('SELECT COUNT(*) FROM employees');
      employeeCount = parseInt(empCountRes.rows[0].count, 10);

      const sessCountRes = await db.query('SELECT COUNT(*) FROM active_employee_sessions WHERE is_active = true');
      activeSessionsCount = parseInt(sessCountRes.rows[0].count, 10);

      const alertStatsRes = await db.query('SELECT severity, COUNT(*) FROM alerts GROUP BY severity');
      alertStatsRes.rows.forEach(r => {
        alertsCount[r.severity] = parseInt(r.count, 10);
      });

      const attackCountRes = await db.query("SELECT COUNT(*) FROM login_events WHERE event_type IN ('failure', 'locked', 'suspicious')");
      attacksCount = parseInt(attackCountRes.rows[0].count, 10);
    } else {
      // Company Admin: Scoped strictly to companyId
      queryParams = [companyId];

      const empCountRes = await db.query('SELECT COUNT(*) FROM employees WHERE company_id = $1', queryParams);
      employeeCount = parseInt(empCountRes.rows[0].count, 10);

      const sessCountRes = await db.query('SELECT COUNT(*) FROM active_employee_sessions WHERE company_id = $1 AND is_active = true', queryParams);
      activeSessionsCount = parseInt(sessCountRes.rows[0].count, 10);

      const alertStatsRes = await db.query('SELECT severity, COUNT(*) FROM alerts WHERE company_id = $1 GROUP BY severity', queryParams);
      alertStatsRes.rows.forEach(r => {
        alertsCount[r.severity] = parseInt(r.count, 10);
      });

      const attackCountRes = await db.query("SELECT COUNT(*) FROM login_events WHERE company_id = $1 AND event_type IN ('failure', 'locked', 'suspicious')", queryParams);
      attacksCount = parseInt(attackCountRes.rows[0].count, 10);
    }

    // Analytics: Attack Trends (Last 7 days, group by day)
    let trendQuery = '';
    if (isSuper) {
      trendQuery = `
        SELECT DATE_TRUNC('day', timestamp) as day, company_id, COUNT(*) as count 
        FROM login_events 
        WHERE event_type IN ('failure', 'locked', 'suspicious') AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY day, company_id ORDER BY day ASC`;
    } else {
      trendQuery = `
        SELECT DATE_TRUNC('day', timestamp) as day, COUNT(*) as count 
        FROM login_events 
        WHERE company_id = $1 AND event_type IN ('failure', 'locked', 'suspicious') AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY day ORDER BY day ASC`;
    }
    const trendRes = await db.query(trendQuery, isSuper ? [] : [companyId]);

    // Analytics: Risk distribution
    let riskQuery = '';
    if (isSuper) {
      riskQuery = `
        SELECT CASE 
          WHEN risk_score BETWEEN 0 AND 30 THEN 'Low (0-30)'
          WHEN risk_score BETWEEN 31 AND 60 THEN 'Medium (31-60)'
          WHEN risk_score BETWEEN 61 AND 80 THEN 'High (61-80)'
          ELSE 'Critical (81-100)'
        END as tier, COUNT(*) as count
        FROM login_events GROUP BY tier`;
    } else {
      riskQuery = `
        SELECT CASE 
          WHEN risk_score BETWEEN 0 AND 30 THEN 'Low (0-30)'
          WHEN risk_score BETWEEN 31 AND 60 THEN 'Medium (31-60)'
          WHEN risk_score BETWEEN 61 AND 80 THEN 'High (61-80)'
          ELSE 'Critical (81-100)'
        END as tier, COUNT(*) as count
        FROM login_events WHERE company_id = $1 GROUP BY tier`;
    }
    const riskRes = await db.query(riskQuery, isSuper ? [] : [companyId]);

    // Calculate company security posture (highest unresolved alert in last 24h)
    let postureQuery = '';
    let postureParams = [];
    if (isSuper) {
      postureQuery = `
        SELECT severity FROM alerts 
        WHERE status = 'active' AND created_at >= NOW() - INTERVAL '24 hours'`;
    } else {
      postureQuery = `
        SELECT severity FROM alerts 
        WHERE company_id = $1 AND status = 'active' AND created_at >= NOW() - INTERVAL '24 hours'`;
      postureParams.push(companyId);
    }
    const postureRes = await db.query(postureQuery, postureParams);
    
    let securityPosture = 'Safe';
    const severities = postureRes.rows.map(r => r.severity);
    if (severities.includes('critical')) {
      securityPosture = 'Critical';
    } else if (severities.includes('high')) {
      securityPosture = 'High';
    } else if (severities.includes('medium')) {
      securityPosture = 'Medium';
    } else if (severities.includes('low')) {
      securityPosture = 'Low';
    }

    return res.status(200).json({
      companiesCount,
      employeeCount,
      activeSessionsCount,
      alertsCount,
      attacksCount,
      trends: trendRes.rows,
      riskDistribution: riskRes.rows,
      securityPosture,
    });

  } catch (error) {
    console.error('Stats query error:', error);
    return res.status(500).json({ error: 'Failed to calculate stats' });
  }
});

// =========================================================================
// SHARED: Get Alerts Feed (Scoped)
// =========================================================================
router.get('/alerts', requireAuth, restrictToTenant, async (req, res) => {
  const isSuper = req.admin.role === 'superadmin';
  const companyId = req.tenantId;
  const search = req.query.search || '';

  try {
    let query = `
      SELECT a.*, c.name as company_name,
             rs.total_score as risk_score, 
             rs.score_breakdown_json as score_breakdown_json
      FROM alerts a
      LEFT JOIN companies c ON a.company_id = c.id
      LEFT JOIN risk_scores rs ON a.login_event_id = rs.login_event_id
    `;
    let queryParams = [];

    if (!isSuper) {
      query += ` WHERE a.company_id = $1`;
      queryParams.push(companyId);
    }

    if (search) {
      query += isSuper ? ` WHERE ` : ` AND `;
      query += `a.reason ILIKE $${queryParams.length + 1}`;
      queryParams.push(`%${search}%`);
    }

    query += ` ORDER BY a.created_at DESC LIMIT 50`;

    const result = await db.query(query, queryParams);
    return res.status(200).json({ alerts: result.rows });
  } catch (error) {
    console.error('Alerts query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve alerts feed' });
  }
});

// =========================================================================
// SHARED: Acknowledge / Dismiss Alert (Scoped)
// =========================================================================
router.post('/alerts/:alertId/action', requireAuth, restrictToTenant, async (req, res) => {
  const { alertId } = req.params;
  const { status } = req.body; // 'acknowledged' or 'dismissed'
  const companyId = req.tenantId;

  if (!['acknowledged', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'acknowledged' or 'dismissed'" });
  }

  try {
    // Verify alert belongs to tenant
    const alertCheck = await db.query('SELECT * FROM alerts WHERE id = $1', [alertId]);
    if (alertCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const alert = alertCheck.rows[0];
    if (req.admin.role !== 'superadmin' && alert.company_id !== companyId) {
      return res.status(403).json({ error: 'Access Denied: Cross-tenant modification' });
    }

    // Update status
    await db.query(
      `UPDATE alerts 
       SET status = $1, acknowledged_by = $2, acknowledged_at = NOW() 
       WHERE id = $3`,
      [status, req.admin.adminId, alertId]
    );

    // Write immutable audit log
    await logAdminAction({
      companyId: alert.company_id,
      adminId: req.admin.adminId,
      action: `${status}_alert`,
      targetType: 'alert',
      targetId: alertId.toString(),
      metadata: { reason: alert.reason },
    });

    return res.status(200).json({ success: true, message: `Alert updated to ${status}.` });

  } catch (error) {
    console.error('Alert action error:', error);
    return res.status(500).json({ error: 'Failed to execute alert action' });
  }
});

// =========================================================================
// SHARED: Lock / Unlock Employee (Scoped + Outbound Callback)
// =========================================================================
router.post('/employees/:id/lock-action', requireAuth, restrictToTenant, async (req, res) => {
  const { id } = req.params; // External Employee ID
  const { lock } = req.body; // boolean: true to lock, false to unlock
  const companyId = req.tenantId;

  try {
    // 1. Find employee and company details
    const employeeRes = await db.query(
      'SELECT email FROM employees WHERE company_id = $1 AND external_employee_id = $2',
      [companyId, id]
    );

    if (employeeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found in registered roster' });
    }

    const employeeEmail = employeeRes.rows[0].email;
    const companyRes = await db.query('SELECT * FROM companies WHERE id = $1', [companyId]);
    const company = companyRes.rows[0];

    // 2. Dispatch callback to client backend to force lock / unlock
    const callbackToken = companyId === 'acme_corp' ? 'acme_secret_key' : 'globex_secret_key';
    const callbackEndpoint = lock ? 'lock-employee' : 'lock-employee';
    
    const url = `${company.callback_url}/lock-employee`;
    
    console.log(`[CENTRAL ADMIN] Requesting ${lock ? 'Lock' : 'Unlock'} callback for ${employeeEmail}`);

    const payload = {
      email: employeeEmail,
      companyId,
      unlock: !lock, // Toggle lock state
      permanent: lock, // Manual locks are permanent!
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', callbackToken).update(rawBody).digest('hex');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': callbackToken,
        'X-Warden-Signature': signature,
      },
      body: rawBody,
    });

    if (!response.ok) {
      throw new Error(`Client callback returned code: ${response.status}`);
    }

    // 2.5 Update Central Database employee record
    await db.query(
      `UPDATE employees 
       SET is_locked = $1, lock_until = null 
       WHERE company_id = $2 AND external_employee_id = $3`,
      [lock, companyId, id]
    );

    if (lock) {
      // Invalidate active session in Central Database
      await db.query(
        'UPDATE active_employee_sessions SET is_active = false WHERE company_id = $1 AND employee_id = $2',
        [companyId, id]
      );
    }

    // 3. Log Immutable Audit Log
    await logAdminAction({
      companyId,
      adminId: req.admin.adminId,
      action: lock ? 'manual_lock_employee' : 'manual_unlock_employee',
      targetType: 'employee',
      targetId: id.toString(),
      metadata: { email: employeeEmail },
    });

    return res.status(200).json({ success: true, message: `Employee successfully ${lock ? 'locked' : 'unlocked'}.` });

  } catch (error) {
    console.error('Lock action error:', error);
    return res.status(500).json({ error: `Failed to execute lock action: ${error.message}` });
  }
});

// =========================================================================
// SHARED: View Employee Timeline (Scoped)
// =========================================================================
router.get('/employees/:id/timeline', requireAuth, restrictToTenant, async (req, res) => {
  const { id } = req.params; // External Employee ID
  const companyId = req.tenantId;

  try {
    const employeeRes = await db.query(
      'SELECT email FROM employees WHERE company_id = $1 AND external_employee_id = $2',
      [companyId, id]
    );

    if (employeeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const email = employeeRes.rows[0].email;

    // Retrieve all events for this employee email
    const eventsRes = await db.query(
      `SELECT le.*, rs.total_score, rs.action_taken, rs.score_breakdown_json 
       FROM login_events le
       LEFT JOIN risk_scores rs ON rs.login_event_id = le.id
       WHERE le.company_id = $1 AND le.email = $2 
       ORDER BY le.timestamp DESC LIMIT 20`,
      [companyId, email]
    );

    return res.status(200).json({ email, timeline: eventsRes.rows });

  } catch (error) {
    console.error('Employee timeline query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve timeline' });
  }
});

// =========================================================================
// SHARED: Get Audit Logs (Scoped)
// =========================================================================
router.get('/audit-logs', requireAuth, restrictToTenant, async (req, res) => {
  const isSuper = req.admin.role === 'superadmin';
  const companyId = req.tenantId;

  try {
    let query = `
      SELECT al.*, ca.email as admin_email 
      FROM audit_logs al
      LEFT JOIN company_admins ca ON al.admin_id = ca.id
    `;
    let queryParams = [];

    if (!isSuper) {
      query += ` WHERE al.company_id = $1`;
      queryParams.push(companyId);
    }

    query += ` ORDER BY al.created_at DESC LIMIT 100`;

    const result = await db.query(query, queryParams);
    return res.status(200).json({ auditLogs: result.rows });

  } catch (error) {
    console.error('Audit logs query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

// =========================================================================
// SUPER ADMIN ONLY: Get System Settings
// =========================================================================
router.get('/settings', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const result = await db.query('SELECT key, value, description, updated_at FROM system_settings ORDER BY key ASC');
    return res.status(200).json({ settings: result.rows });
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return res.status(500).json({ error: 'Failed to retrieve system settings' });
  }
});

// =========================================================================
// SUPER ADMIN ONLY: Update System Settings (Bulk or Single)
// =========================================================================
router.post('/settings', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { settings } = req.body; // Expects array [{ key: '...', value: '...' }] or single { key: '...', value: '...' }

  try {
    await db.query('BEGIN');

    const updates = Array.isArray(settings) ? settings : [req.body];

    for (const update of updates) {
      const { key, value } = update;
      if (!key || value === undefined) {
        throw new Error('Key and Value are required for settings update');
      }

      await db.query(
        `INSERT INTO system_settings (key, value, updated_at) 
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value.toString()]
      );
    }

    await db.query('COMMIT');

    // Load fresh settings in the rule engine dynamically
    const { refreshSettings } = require('../engine/ruleEngine');
    await refreshSettings();

    // Write immutable audit log
    await logAdminAction({
      companyId: null,
      adminId: req.admin.adminId,
      action: 'update_system_settings',
      targetType: 'system_settings',
      targetId: 'global',
      metadata: { count: updates.length },
    });

    return res.status(200).json({ success: true, message: 'System settings updated successfully.' });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Failed to update settings:', error);
    return res.status(500).json({ error: error.message || 'Failed to update system settings' });
  }
});

// =========================================================================
// SHARED: Get Locked Employees (Scoped)
// =========================================================================
router.get('/employees/locked', requireAuth, restrictToTenant, async (req, res) => {
  const companyId = req.tenantId;

  try {
    let query = `
      SELECT e.id, e.company_id, e.external_employee_id, e.email, e.is_locked, e.lock_until, c.name as company_name
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      WHERE e.is_locked = true AND (e.lock_until IS NULL OR e.lock_until > NOW())
    `;
    const queryParams = [];

    if (companyId) {
      query += ` AND e.company_id = $1`;
      queryParams.push(companyId);
    }

    query += ` ORDER BY e.lock_until DESC NULLS FIRST, e.email ASC`;

    const result = await db.query(query, queryParams);
    return res.status(200).json({ lockedEmployees: result.rows });
  } catch (error) {
    console.error('Locked employees query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve locked employees' });
  }
});

// =========================================================================
// SHARED: Get All Employees Directory (Scoped)
// =========================================================================
router.get('/employees', requireAuth, restrictToTenant, async (req, res) => {
  const companyId = req.tenantId;

  try {
    let query = `
      SELECT 
        e.id, 
        e.company_id, 
        c.name AS company_name, 
        e.external_employee_id, 
        e.email, 
        e.is_locked, 
        e.lock_until,
        COALESCE(bb.avg_login_hour_start, 8) AS allowed_start_hour,
        COALESCE(bb.avg_login_hour_end, 17) AS allowed_end_hour,
        le.timestamp AS last_login_time,
        le.ip_address AS last_login_ip,
        le.city AS last_login_city,
        le.country AS last_login_country,
        le.risk_score AS last_risk_score,
        aes.is_active AS is_session_active,
        aes.started_at AS session_started_at,
        aes.last_active AS session_last_active
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      LEFT JOIN behavior_baselines bb ON bb.company_id = e.company_id AND bb.employee_id = e.external_employee_id
      LEFT JOIN LATERAL (
        SELECT timestamp, ip_address, city, country, risk_score 
        FROM login_events 
        WHERE company_id = e.company_id AND employee_id = e.external_employee_id
        ORDER BY timestamp DESC 
        LIMIT 1
      ) le ON TRUE
      LEFT JOIN LATERAL (
        SELECT is_active, started_at, last_active 
        FROM active_employee_sessions 
        WHERE company_id = e.company_id AND employee_id = e.external_employee_id AND is_active = true
        ORDER BY started_at DESC 
        LIMIT 1
      ) aes ON TRUE
    `;
    const queryParams = [];

    if (companyId) {
      query += ` WHERE e.company_id = $1`;
      queryParams.push(companyId);
    }

    query += ` ORDER BY e.company_id ASC, e.email ASC`;

    const result = await db.query(query, queryParams);
    return res.status(200).json({ employees: result.rows });
  } catch (error) {
    console.error('All employees query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve employees directory' });
  }
});

// =========================================================================
// SHARED: Update Allowed Login Hours (Scoped)
// =========================================================================
router.post('/employees/:id/hours', requireAuth, restrictToTenant, async (req, res) => {
  const { id } = req.params; // External Employee ID
  const { startHour, endHour } = req.body; // integer hours (0-23)
  const companyId = req.tenantId;

  if (startHour === undefined || endHour === undefined) {
    return res.status(400).json({ error: 'startHour and endHour are required' });
  }

  const externalEmployeeId = parseInt(id, 10);
  if (isNaN(externalEmployeeId)) {
    return res.status(400).json({ error: 'Invalid employee ID' });
  }

  try {
    // Verify employee exists
    const empRes = await db.query(
      'SELECT id FROM employees WHERE company_id = $1 AND external_employee_id = $2',
      [companyId, externalEmployeeId]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Check if baseline exists
    const baseRes = await db.query(
      'SELECT id FROM behavior_baselines WHERE company_id = $1 AND employee_id = $2',
      [companyId, externalEmployeeId]
    );

    if (baseRes.rows.length === 0) {
      await db.query(
        `INSERT INTO behavior_baselines (company_id, employee_id, avg_login_hour_start, avg_login_hour_end) 
         VALUES ($1, $2, $3, $4)`,
        [companyId, externalEmployeeId, startHour, endHour]
      );
    } else {
      await db.query(
        `UPDATE behavior_baselines 
         SET avg_login_hour_start = $1, avg_login_hour_end = $2 
         WHERE company_id = $3 AND employee_id = $4`,
        [startHour, endHour, companyId, externalEmployeeId]
      );
    }

    // Log Immutable Audit Log
    await logAdminAction({
      companyId,
      adminId: req.admin.adminId,
      action: 'update_allowed_hours',
      targetType: 'employee',
      targetId: id.toString(),
      metadata: { startHour, endHour },
    });

    return res.status(200).json({ success: true, message: 'Allowed hours updated successfully' });
  } catch (error) {
    console.error('Update allowed hours error:', error);
    return res.status(500).json({ error: 'Failed to update allowed hours' });
  }
});

module.exports = router;

