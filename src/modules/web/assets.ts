import type { FastifyInstance } from 'fastify';

const styles = `
:root {
  color-scheme: light;
  --bg: #f4f6f8;
  --card: #ffffff;
  --text: #17202a;
  --muted: #667085;
  --border: #d8dee6;
  --primary: #1f6feb;
  --primary-dark: #174ea6;
  --danger-bg: #fff1f2;
  --danger-border: #fecdd3;
  --danger-text: #9f1239;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Arial, Helvetica, sans-serif;
}

a {
  color: var(--primary);
}

.auth-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
}

.card {
  width: min(100%, 420px);
  padding: 28px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgb(15 23 42 / 8%);
}

.app-shell {
  width: min(100%, 980px);
  margin: 0 auto;
  padding: 32px 20px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

h1,
h2,
p {
  margin-top: 0;
}

.muted {
  color: var(--muted);
}

.field {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}

label {
  font-weight: 700;
}

input,
select {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font: inherit;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  font-weight: 700;
}

.checkbox-field input {
  width: auto;
}

textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font: inherit;
  resize: vertical;
}

button,
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 10px 16px;
  background: var(--primary);
  color: #fff;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
}

button:hover,
.button:hover {
  background: var(--primary-dark);
}

.button-secondary {
  background: #eef2f7;
  color: var(--text);
}

.button-secondary:hover {
  background: #e2e8f0;
}

.link-button {
  display: inline;
  min-height: auto;
  padding: 0;
  background: transparent;
  color: var(--primary);
  border: 0;
  border-radius: 0;
  cursor: pointer;
  font: inherit;
  font-weight: 400;
  text-decoration: underline;
}

.link-button:hover {
  background: transparent;
  color: var(--primary-dark);
}

.alert-error {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  border-radius: 10px;
  color: var(--danger-text);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.field-full {
  grid-column: 1 / -1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.panel {
  padding: 18px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.spacing-top {
  margin-top: 18px;
}

pre {
  overflow-x: auto;
  padding: 14px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 10px;
}

.table-wrap {
  overflow-x: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

th {
  color: var(--muted);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

tr:last-child td {
  border-bottom: 0;
}

.table-actions {
  display: flex;
  gap: 12px;
}

.status-pill {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}

.status-on {
  background: #dcfce7;
  color: #166534;
}

.status-off {
  background: #f1f5f9;
  color: #475569;
}

form[data-inline] {
  display: inline;
}

.conversation-stack {
  display: grid;
  gap: 12px;
}

.message-card {
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.message-inbound {
  border-left: 4px solid #16a34a;
}

.message-outbound {
  border-left: 4px solid var(--primary);
}
`;

export function registerAssetsRoutes(app: FastifyInstance): void {
  app.get('/styles.css', async (_request, reply) => reply.type('text/css').send(styles));
}
