import { config } from 'dotenv';
import { z } from 'zod';

config();

const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: optionalUrl,
    DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z.string().min(16).optional(),
    ENCRYPTION_KEY: z.string().min(32).optional(),
    DEFAULT_TIMEZONE: z.string().default('America/Sao_Paulo'),
    OPENAI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    WEBHOOK_SHARED_SECRET: z.string().optional(),
    WEB_RESEARCH_ENDPOINT: optionalUrl,
    WEB_RESEARCH_API_KEY: z.string().optional(),
    WEB_RESEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SCHEDULER_ENABLED: z.coerce.boolean().default(false),
    INITIAL_OUTREACH_CRON: z.string().default('* * * * *'),
    FOLLOWUP_CRON: z.string().default('*/5 * * * *'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'test' && !value.DATABASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required outside test environment',
      });
    }

    if (value.NODE_ENV !== 'test' && !value.SESSION_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET is required outside test environment',
      });
    }

    if (value.NODE_ENV !== 'test' && !value.ENCRYPTION_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message: 'ENCRYPTION_KEY is required outside test environment',
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables', parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;
export type AppEnv = typeof env;
