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
    DEEPSEEK_API_KEY: z.string().optional(),
    WEBHOOK_SHARED_SECRET: z.string().optional(),
    WEB_RESEARCH_ENDPOINT: optionalUrl,
    WEB_RESEARCH_API_KEY: z.string().optional(),
    WEB_RESEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    // z.coerce.boolean() usa Boolean(string): "false"/"0"/"no" virariam true. Aceita so o texto.
    SCHEDULER_ENABLED: z
      .preprocess((value) => (typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()) : value), z.boolean())
      .default(false),
    INITIAL_OUTREACH_CRON: z.string().default('* * * * *'),
    FOLLOWUP_CRON: z.string().default('*/5 * * * *'),
    INBOUND_RESPONSE_BUFFER_MS: z.coerce.number().int().min(20000).default(20000),
    // Rede de seguranca do lead que respondeu e ficou sem resposta (deploy no meio do buffer,
    // erro da IA, envio recusado pela UAZAPI).
    PENDING_REPLY_CRON: z.string().default('*/5 * * * *'),
    PENDING_REPLY_AFTER_MS: z.coerce.number().int().min(60000).default(180000),
    PENDING_REPLY_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
    // Vigia das instancias: le o status do WhatsApp de cada SDR e avisa quem caiu.
    // O webhook `connection` faz o mesmo na hora; este tick e a rede de seguranca.
    CONNECTION_MONITOR_CRON: z.string().default('*/5 * * * *'),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
    UAZAPI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    // Servidor UAZAPI usado para criar a instancia de um SDR novo. Sem os dois, o portal
    // segue funcionando e o usuario cadastra a instancia na mao.
    UAZAPI_BASE_URL: optionalUrl,
    UAZAPI_ADMIN_TOKEN: z.string().optional(),
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
