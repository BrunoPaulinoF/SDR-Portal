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
  --primary-soft: #e8f1ff;
  --danger-bg: #fff1f2;
  --danger-border: #fecdd3;
  --danger-text: #9f1239;
  --sidebar: #0f172a;
  --sidebar-muted: #94a3b8;
  --sidebar-active: #1d4ed8;
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

.app-frame {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 22px 18px;
  background: var(--sidebar);
  color: #fff;
}

.brand {
  display: grid;
  gap: 4px;
  padding: 4px 8px 22px;
  border-bottom: 1px solid rgb(255 255 255 / 12%);
}

.brand strong {
  font-size: 20px;
}

.brand span,
.nav-group p {
  color: var(--sidebar-muted);
  font-size: 13px;
}

.nav-groups {
  display: grid;
  gap: 24px;
  margin-top: 24px;
}

.nav-group {
  display: grid;
  gap: 6px;
}

.nav-group p {
  margin: 0 0 4px;
  padding: 0 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.nav-link {
  display: block;
  padding: 10px 12px;
  color: #e2e8f0;
  border-radius: 10px;
  font-weight: 700;
  text-decoration: none;
}

.nav-link:hover,
.nav-active {
  background: var(--sidebar-active);
  color: #fff;
}

.sidebar-logout {
  margin-top: auto;
  padding-top: 18px;
}

.sidebar-logout .button {
  width: 100%;
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
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: 32px 24px 48px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.topbar h1 {
  margin-bottom: 6px;
}

.page-section {
  display: grid;
  gap: 14px;
  margin-bottom: 28px;
}

.section-heading {
  display: grid;
  gap: 4px;
}

.section-heading h2 {
  margin-bottom: 0;
}

.module-card {
  display: grid;
  gap: 12px;
  align-content: start;
}

.module-card .button {
  justify-self: start;
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

.panel > summary {
  cursor: pointer;
  font-size: 18px;
}

.panel > summary + * {
  margin-top: 16px;
}

.empty-state {
  padding: 22px;
  background: var(--card);
  border: 1px dashed var(--border);
  border-radius: 14px;
}

.form-sections {
  display: grid;
  gap: 14px;
}

.form-section {
  padding: 0;
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.form-section summary {
  padding: 16px 18px;
  cursor: pointer;
  font-size: 18px;
  font-weight: 800;
}

.form-section summary span {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 400;
}

.form-section-body {
  padding: 0 18px 18px;
}

.tabs-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.tabs-inline a {
  padding: 8px 12px;
  background: #eef2f7;
  color: var(--text);
  border-radius: 999px;
  font-weight: 700;
  text-decoration: none;
}

.tabs-inline a:hover {
  background: var(--primary-soft);
  color: var(--primary-dark);
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

.status-warn {
  background: #fef3c7;
  color: #92400e;
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

@media (max-width: 860px) {
  .app-frame {
    display: block;
  }

  .sidebar {
    position: static;
    height: auto;
    padding: 14px;
  }

  .brand {
    padding-bottom: 12px;
  }

  .nav-groups {
    gap: 14px;
    margin-top: 14px;
  }

  .nav-group {
    display: flex;
    flex-wrap: wrap;
  }

  .nav-group p {
    width: 100%;
  }

  .sidebar-logout {
    margin-top: 14px;
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .app-shell {
    padding: 24px 16px 36px;
  }
}
`;

export function registerAssetsRoutes(app: FastifyInstance): void {
  app.get('/styles.css', async (_request, reply) => reply.type('text/css').send(styles));
}
