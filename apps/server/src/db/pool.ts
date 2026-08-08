/**
 * PostgreSQL 连接池
 * 单一连接池，所有 DB 操作共享
 */
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { config } from "../config.js";

const pool = new Pool({
  connectionString: config.databaseUrl || undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
});

pool.on("error", (err) => {
  console.error("Unexpected pg pool error", err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (duration > 1_000) {
    console.warn(`Slow query (${duration}ms): ${text.slice(0, 80)}`);
  }
  return res;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<boolean> {
  try {
    const res = await query<{ now: string }>("SELECT NOW() as now");
    return !!res.rows[0]?.now;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
