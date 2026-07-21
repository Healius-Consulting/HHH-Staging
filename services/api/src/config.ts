import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174'),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_STORAGE_BUCKET: z.string().min(1).optional(),
  REQUIRE_APP_CHECK: z.enum(['true', 'false']).default('false'),
  REQUIRE_MFA: z.enum(['true', 'false']).default('false'),
  CURALEAF_BASE_URL: z.url().default('https://api.curaleaflaboratories.dev'),
  CURALEAF_API_KEY: z.string().min(16).max(500).optional(),
  WORLDPAY_HPP_BASE_URL: z.url().optional(),
  WORLDPAY_VERIFY_BASE_URL: z.url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const config = schema.parse(process.env);
export const allowedOrigins = new Set(config.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean));
