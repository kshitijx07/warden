const db = require('../config/db');

async function getConsecutiveFailures(email) {
  try {
    const result = await db.query(
      `SELECT success FROM login_attempts 
       WHERE email = $1 AND created_at >= NOW() - INTERVAL '15 minutes' 
       ORDER BY created_at DESC`,
      [email]
    );

    let failures = 0;
    for (const row of result.rows) {
      if (!row.success) {
        failures++;
      } else {
        break;
      }
    }
    return failures;
  } catch (error) {
    console.error('Error fetching consecutive failures:', error);
    return 0;
  }
}

async function progressiveDelayMiddleware(req, res, next) {
  const { email, captchaSolved } = req.body;
  if (!email) {
    return next();
  }

  const failures = await getConsecutiveFailures(email);
  req.consecutiveFailures = failures;

  // Enforce Lock Check first
  try {
    const employeeRes = await db.query('SELECT is_locked, lock_until FROM employees WHERE email = $1', [email]);
    if (employeeRes.rows.length > 0) {
      const emp = employeeRes.rows[0];
      if (emp.is_locked) {
        const isExpired = emp.lock_until && new Date(emp.lock_until) <= new Date();
        if (!isExpired) {
          const remainingSeconds = emp.lock_until 
            ? Math.ceil((new Date(emp.lock_until) - new Date()) / 1000)
            : -1; // -1 indicates permanent/indefinite lock

          return res.status(423).json({
            status: 'locked',
            message: remainingSeconds === -1 
              ? 'Account has been locked by an administrator.' 
              : 'Account is temporarily locked due to excessive failed attempts.',
            lockoutRemaining: remainingSeconds,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking lock status in middleware:', error);
  }

  // Enforce CAPTCHA if failure threshold is 5 or 6
  if (failures >= 5) {
    if (!captchaSolved) {
      return res.status(400).json({
        status: 'captcha_required',
        message: 'Suspicious activity detected. Please complete the CAPTCHA.',
        failures,
      });
    }
  }

  // Enforce progressive delays
  let delay = 0;
  if (failures === 2) {
    delay = 2000;
  } else if (failures >= 3) {
    delay = 5000;
  }

  if (delay > 0) {
    console.log(`Delaying request for ${email} by ${delay}ms (consecutive failures: ${failures})`);
    setTimeout(() => {
      next();
    }, delay);
  } else {
    next();
  }
}

module.exports = {
  progressiveDelayMiddleware,
  getConsecutiveFailures,
};
