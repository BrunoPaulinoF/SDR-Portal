ALTER TABLE "sdr_agents" ALTER COLUMN "ai_reasoning_effort" SET DEFAULT 'default';--> statement-breakpoint
-- O campo nasceu na 0014 com default 'low', mas 'low' e um nivel real: no DeepSeek ele
-- reduz o raciocinio em relacao ao padrao do modelo ('high'). Como ninguem chegou a
-- escolher um nivel, o valor herdado volta para 'default' (nao envia o parametro).
UPDATE "sdr_agents" SET "ai_reasoning_effort" = 'default' WHERE "ai_reasoning_effort" = 'low';
