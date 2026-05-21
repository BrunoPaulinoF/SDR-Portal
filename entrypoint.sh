#!/bin/sh
set -e

echo "==> SDR Portal entrypoint"

if [ -z "$DATABASE_URL" ]; then
  echo "ERRO: DATABASE_URL nao definida."
  exit 1
fi

echo "==> Aguardando Postgres em DATABASE_URL..."
until node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  sql\`SELECT 1\`.then(() => { sql.end(); process.exit(0); }).catch(() => { sql.end(); process.exit(1); });
" 2>/dev/null; do
  echo "   postgres indisponivel, aguardando 2s..."
  sleep 2
done

echo "==> Postgres disponivel. Aplicando migrations..."
node dist/db/migrate.js

echo "==> Verificando criacao de admin..."
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  node dist/db/create-admin.js || echo "   (admin ja existe ou erro — continuando)"
else
  echo "   ADMIN_EMAIL/ADMIN_PASSWORD nao definidos — pulando."
fi

echo "==> Iniciando aplicacao na porta ${PORT:-3000}..."
exec node dist/server.js
