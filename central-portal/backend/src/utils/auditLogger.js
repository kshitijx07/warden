const db = require('../config/db');

async function logAdminAction({ companyId, adminId, action, targetType, targetId, metadata }) {
  try {
    // Write direct INSERT statement
    await db.query(
      `INSERT INTO audit_logs (company_id, admin_id, action, target_type, target_id, metadata_json) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        companyId || null,
        adminId || null,
        action,
        targetType,
        targetId || 'N/A',
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (error) {
    console.error('Audit Log writing failed:', error);
  }
}

module.exports = {
  logAdminAction,
};
