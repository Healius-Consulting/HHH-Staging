import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const db = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL, ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined, max: 10 }) : null;
