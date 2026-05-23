const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5439', 10),
  database: process.env.DB_NAME || 'warden_client_acme',
  max: 10,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
