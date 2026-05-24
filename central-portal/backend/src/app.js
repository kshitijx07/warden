const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const { rateLimit } = require('express-rate-limit');

const db = require('./config/db');
const { initSocket } = require('./services/socket');
const { computeBehaviorBaselines } = require('./engine/baselineJob');
const { startPolling } = require('./services/telemetryPoller');

const ingestRouter = require('./routes/ingest');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Initialize Socket.IO
initSocket(server);

// Security Middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.CENTRAL_FRONTEND_URL || 'http://localhost:3002',
    credentials: true,
  })
);

// Body Parsing
app.use(express.json());

// Rate limiting on ingestion endpoint
const ingestionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 100, // max 100 requests per IP per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many ingestion events from this source, please slow down.' },
});

// Routes
app.use('/api/v1/events', ingestionLimiter, ingestRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin', adminRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'warden-central-backend' });
});

// Schedule nightly behavior baseline cron job (Runs daily at 02:00)
cron.schedule('0 2 * * *', async () => {
  await computeBehaviorBaselines();
});

// Automatic Seeder for Central Platform
async function seedCentralSystem() {
  try {
    const res = await db.query('SELECT COUNT(*) FROM companies');
    const companyCount = parseInt(res.rows[0].count, 10);

    if (companyCount === 0) {
      console.log('[SEEDER] Database is empty. Seeding system with default data...');

      await db.query('BEGIN');

      // 1. Seed companies (Acme & Globex)
      const acmeKeyHash = await bcrypt.hash('acme_secret_key', 10);
      const globexKeyHash = await bcrypt.hash('globex_secret_key', 10);

      await db.query(
        `INSERT INTO companies (id, name, domain, api_key_hash, callback_url) 
         VALUES 
         ('acme_corp', 'Acme Corporation', 'acme.com', $1, 'http://localhost:4001/api/v1/auth/callback'),
         ('globex_corp', 'Globex Corporation', 'globex.com', $2, 'http://localhost:4002/api/v1/auth/callback')`,
        [acmeKeyHash, globexKeyHash]
      );

      // 2. Seed admins (Super Admin and Company Admin for Acme)
      const superHash = await bcrypt.hash('password123', 10);
      const acmeAdminHash = await bcrypt.hash('password123', 10);

      await db.query(
        `INSERT INTO company_admins (company_id, email, password_hash, role) 
         VALUES 
         (null, 'superadmin@warden.com', $1, 'superadmin'),
         ('acme_corp', 'admin@acme.com', $2, 'company_admin')`,
        [superHash, acmeAdminHash]
      );

      // 3. Seed employees roster in central DB
      await db.query(
        `INSERT INTO employees (company_id, external_employee_id, email) 
         VALUES 
         ('acme_corp', 1, 'employee@acme.com'),
         ('globex_corp', 1, 'employee@globex.com')`
      );

      // 4. Seed behavior baseline for Acme employee to test Impossible Travel
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.query(
        `INSERT INTO behavior_baselines (company_id, employee_id, avg_login_hour_start, avg_login_hour_end, common_ips, common_countries, last_successful_login_lat, last_successful_login_lng, last_successful_login_time) 
         VALUES 
         ('acme_corp', 1, 8, 18, '["127.0.0.1", "82.165.195.10"]'::jsonb, '["GB", "US"]'::jsonb, 51.5074, -0.1278, $1),
         ('globex_corp', 1, 8, 18, '["127.0.0.1"]'::jsonb, '["US"]'::jsonb, null, null, null)`,
        [yesterday]
      );

      await db.query('COMMIT');
      console.log('[SEEDER] Seeding central database successfully completed!');
      console.log('[SEEDER] Logins created:');
      console.log(' - Super Admin: superadmin@warden.com / password123');
      console.log(' - Acme Admin: admin@acme.com / password123');
    }
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('[SEEDER] Failed to seed Central database:', error);
  }
}

// Start Server
server.listen(PORT, async () => {
  console.log(`Warden Central Backend running on port ${PORT}`);
  await seedCentralSystem();
  startPolling();
});
