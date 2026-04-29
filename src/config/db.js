const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  // Obligamos a usar SOLO la cadena de conexión de Supabase
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en cliente idle:', err.message);
});

const query = (text, params) => pool.query(text, params);

const getClient = async () => {
  const client = await pool.connect();
  return { client, done: () => client.release() };
};

const withTransaction = async (fn) => {
  const { client, done } = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    done();
  }
};

module.exports = { query, getClient, withTransaction };