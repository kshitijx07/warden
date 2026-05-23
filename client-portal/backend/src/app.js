const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const db = require('./config/db');
const authRouter = require('./routes/auth');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4001;

// Helmet for security headers
app.use(helmet());

// CORS configuration (allow requests from the specific company's frontend domain)
const allowedOrigin = process.env.CLIENT_FRONTEND_URL || 'http://localhost:3001';
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// Body parsing
app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', tenant: process.env.TENANT_ID });
});

// Automatic Seeder for Local Test Employees
async function seedEmployees() {
  try {
    const res = await db.query('SELECT COUNT(*) FROM employees');
    const count = parseInt(res.rows[0].count, 10);
    
    if (count === 0) {
      console.log('No employees found in client DB. Seeding test employee...');
      
      const email = process.env.TENANT_ID === 'acme_corp' ? 'employee@acme.com' : 'employee@globex.com';
      const password = 'password123';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      
      await db.query(
        'INSERT INTO employees (email, password_hash) VALUES ($1, $2)',
        [email, hash]
      );
      
      console.log(`Successfully seeded employee test account:`);
      console.log(`- Email: ${email}`);
      console.log(`- Password: ${password}`);
    }
  } catch (error) {
    console.error('Error seeding test employee:', error);
  }
}

// Periodically clear expired lockouts (every 60 seconds)
setInterval(async () => {
  try {
    const res = await db.query(
      `UPDATE employees 
       SET is_locked = false, lock_until = null, failed_attempts = 0 
       WHERE is_locked = true AND lock_until < NOW()`
    );
    if (res.rowCount > 0) {
      console.log(`[LOCK EXPIRY] Automatically unlocked ${res.rowCount} employee account(s) due to expiry.`);
    }
  } catch (err) {
    console.error('[LOCK EXPIRY ERROR]', err);
  }
}, 60000);

// Boot server
app.listen(PORT, async () => {
  console.log(`Client Portal Backend running on port ${PORT} for tenant ${process.env.TENANT_ID}`);
  await seedEmployees();
});
