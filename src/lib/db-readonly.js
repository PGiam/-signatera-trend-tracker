import pg from 'pg';

const { Pool } = pg;

let pool;

// Connects as the restricted `app_readonly_query` Postgres role (see
// sql/002_readonly_role_and_views.sql) — that role has no write grants on
// anything, which is the outermost of the three independent guardrail
// layers described in the ask.js query flow.
export function getReadonlyPool() {
  if (!pool) {
    const connectionString = import.meta.env.SUPABASE_READONLY_DB_URL;
    if (!connectionString) {
      throw new Error('SUPABASE_READONLY_DB_URL must be set');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

const STATEMENT_TIMEOUT_MS = 5000;

/**
 * Runs a single validated SELECT inside an explicit read-only transaction,
 * always rolling back (never commits — nothing should ever be written by
 * this path, and ROLLBACK makes that true even in the face of a bug
 * upstream). This is a Postgres-level guarantee layered on top of the
 * role's own lack of write grants and its role-level statement_timeout.
 */
export async function runReadonlyQuery(sql) {
  const client = await getReadonlyPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(sql);
    return result.rows;
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection may already be broken (e.g. statement_timeout fired) — ignore
    }
    client.release();
  }
}
