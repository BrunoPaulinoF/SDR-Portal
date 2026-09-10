-- Quem decide quantas abordagens saem por dia nao e o limite: entre um envio e o proximo o
-- disparo espera um cooldown sorteado, entao o teto real e a janela dividida pela media do
-- cooldown. Com janela 15:00-21:00 (360min) e cooldown 5-15min (media 10) a conta dava ~37 e o
-- limite de 40 gravado pela migracao 0025 nunca era alcancado (docs/analises/revisao-2026-09-08.md).
-- Encurta o cooldown para 4-14min (media 9, ~41 envios em 360min) so onde as duas coisas valem:
-- a janela atual nao comporta o limite E o cooldown novo resolve. SDR com folga ou com cooldown
-- ajustado a mao fica como esta, porque apertar o espacamento sem necessidade e o sinal de volume
-- que levou a Francielly ao WHATSAPP_REACHOUT_TIMELOCK em 27/08.
WITH capacidade AS (
	SELECT
		"id",
		"daily_initial_send_limit" AS limite,
		(LEAST("initial_cooldown_min_minutes", "initial_cooldown_max_minutes")
			+ GREATEST("initial_cooldown_min_minutes", "initial_cooldown_max_minutes"))::numeric / 2 AS cooldown_medio,
		CASE WHEN fim >= inicio THEN fim - inicio ELSE 1440 - inicio + fim END AS janela
	FROM (
		SELECT
			"id",
			"daily_initial_send_limit",
			"initial_cooldown_min_minutes",
			"initial_cooldown_max_minutes",
			split_part("send_window_start", ':', 1)::int * 60 + split_part("send_window_start", ':', 2)::int AS inicio,
			split_part("send_window_end", ':', 1)::int * 60 + split_part("send_window_end", ':', 2)::int AS fim
		FROM "sdr_agents"
	) AS janelas
)
UPDATE "sdr_agents" AS agentes
SET "initial_cooldown_min_minutes" = 4,
	"initial_cooldown_max_minutes" = 14
FROM capacidade
WHERE capacidade."id" = agentes."id"
	AND capacidade.cooldown_medio > 0
	AND floor(capacidade.janela / capacidade.cooldown_medio) + 1 < capacidade.limite
	AND floor(capacidade.janela / 9.0) + 1 >= capacidade.limite;
