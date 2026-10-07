import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

export class Store {
  readonly pool: pg.Pool;
  constructor(connectionString: string, schema = 'public') {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database namespace');
    this.pool = new pg.Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
  }
  async migrate() {
    const directory = new URL('./migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      await this.pool.query(await readFile(new URL(file, directory), 'utf8'));
    }
  }
  async transaction<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally { db.release(); }
  }
  async close() { await this.pool.end(); }
}
