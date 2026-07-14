import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174'),
  ALLOW_DEV_PORTAL_TOKEN: z.enum(['true', 'false']).default('true'),
  PORTAL_API_TOKEN: z.string().min(24).default('hhh-local-development-token-2026'),
  CURALEAF_BASE_URL: z.url().default('https://api.curaleaflaboratories.dev'),
  CURALEAF_READ_API_KEY: z.string().min(24).optional(),
  CURALEAF_WRITE_API_KEY: z.string().min(24).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.DATABASE_URL) {
    context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL is required in production.' });
  }
});

export const config = schema.parse(process.env);
export const allowedOrigins = new Set(config.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean));
