const db = require('../config/db');

async function computeBehaviorBaselines() {
  console.log('[CRON JOB] Starting nightly behavior baseline calculations...');
  try {
    // 1. Fetch all registered employees
    const employeesRes = await db.query('SELECT company_id, external_employee_id, email FROM employees');
    console.log(`[CRON JOB] Processing baselines for ${employeesRes.rows.length} employees`);

    for (const employee of employeesRes.rows) {
      const { company_id, external_employee_id, email } = employee;

      // 2. Fetch successful login history for the last 30 days
      const historyRes = await db.query(
        `SELECT timestamp, country, ip_address 
         FROM login_events 
         WHERE company_id = $1 AND employee_id = $2 AND event_type = 'success' 
         AND timestamp >= NOW() - INTERVAL '30 days'`,
        [company_id, external_employee_id]
      );

      if (historyRes.rows.length === 0) {
        // No success events - keep/insert default baseline settings
        continue;
      }

      const events = historyRes.rows;

      // 3. Compute hour average
      let hourSum = 0;
      events.forEach(e => {
        const hour = new Date(e.timestamp).getUTCHours();
        hourSum += hour;
      });
      const avgHour = Math.round(hourSum / events.length);
      const startHour = (avgHour - 4 + 24) % 24; // 4 hours window before
      const endHour = (avgHour + 4) % 24;        // 4 hours window after

      // 4. Extract common countries
      const countryCounts = {};
      events.forEach(e => {
        if (e.country) {
          countryCounts[e.country] = (countryCounts[e.country] || 0) + 1;
        }
      });
      const commonCountries = Object.entries(countryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(entry => entry[0]);

      // 5. Extract common IPs
      const ipCounts = {};
      events.forEach(e => {
        if (e.ip_address) {
          ipCounts[e.ip_address] = (ipCounts[e.ip_address] || 0) + 1;
        }
      });
      const commonIps = Object.entries(ipCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(entry => entry[0]);

      // 6. Update baseline record
      await db.query(
        `INSERT INTO behavior_baselines (company_id, employee_id, avg_login_hour_start, avg_login_hour_end, common_ips, common_countries, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
         ON CONFLICT (id) DO UPDATE SET 
           avg_login_hour_start = EXCLUDED.avg_login_hour_start,
           avg_login_hour_end = EXCLUDED.avg_login_hour_end,
           common_ips = EXCLUDED.common_ips,
           common_countries = EXCLUDED.common_countries,
           updated_at = NOW()`,
        [
          company_id,
          external_employee_id,
          startHour,
          endHour,
          JSON.stringify(commonIps),
          JSON.stringify(commonCountries),
        ]
      );

      console.log(`[CRON JOB] Updated behavior baseline for ${email} (Hours: ${startHour}:00-${endHour}:00 UTC)`);
    }
    console.log('[CRON JOB] Nightly behavior baselines processing completed successfully.');
  } catch (error) {
    console.error('[CRON JOB] Error computing behavior baselines:', error);
  }
}

module.exports = {
  computeBehaviorBaselines,
};
