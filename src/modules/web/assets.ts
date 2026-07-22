import type { FastifyInstance } from 'fastify';

const styles = `
:root {
  color-scheme: light;
  --bg: #f4f6fa;
  --card: #ffffff;
  --surface-muted: #f7f9fc;
  --text: #171b24;
  --muted: #667085;
  --border: #e3e7ee;
  --border-strong: #d3d9e3;
  --primary: #1f6feb;
  --primary-dark: #174ea6;
  --primary-soft: #eaf2ff;
  --danger-bg: #fff1f2;
  --danger-border: #fecdd3;
  --danger-text: #9f1239;
  --sidebar: #10162a;
  --sidebar-muted: #8f9bb8;
  --sidebar-active: #2456d6;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 2px rgb(16 24 40 / 6%);
  --shadow-md: 0 6px 20px rgb(16 24 40 / 8%);
  --shadow-lg: 0 20px 50px rgb(16 24 40 / 12%);
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--primary);
}

h1 {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

h2 {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.app-frame {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px 16px;
  background: var(--sidebar);
  color: #fff;
}

.brand {
  display: grid;
  gap: 3px;
  padding: 6px 10px 20px;
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.brand strong {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.brand span,
.nav-group p {
  color: var(--sidebar-muted);
  font-size: 12.5px;
}

.nav-groups {
  display: grid;
  gap: 22px;
  margin-top: 22px;
}

.nav-group {
  display: grid;
  gap: 3px;
}

.nav-group p {
  margin: 0 0 6px;
  padding: 0 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

.nav-link {
  display: block;
  padding: 9px 12px;
  color: #d6ddec;
  border-radius: var(--radius-sm);
  font-weight: 600;
  text-decoration: none;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.nav-link:hover {
  background: rgb(255 255 255 / 8%);
  color: #fff;
}

.nav-active,
.nav-active:hover {
  background: var(--sidebar-active);
  color: #fff;
  font-weight: 700;
}

.sidebar-logout {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgb(255 255 255 / 10%);
}

.sidebar-logout .button {
  width: 100%;
  background: rgb(255 255 255 / 8%);
  color: #e7ebf5;
}

.sidebar-logout .button:hover {
  background: rgb(255 255 255 / 14%);
}

.auth-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: radial-gradient(circle at top, #eef3ff 0%, var(--bg) 55%);
}

.card {
  width: min(100%, 420px);
  padding: 30px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.app-shell {
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: 30px 28px 52px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 26px;
}

.topbar h1 {
  margin-bottom: 4px;
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
  gap: 7px;
  margin-bottom: 16px;
}

label {
  font-weight: 700;
  font-size: 14px;
}

.label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.help-tooltip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  color: var(--primary-dark);
  background: var(--primary-soft);
  border: 1px solid #cfe1ff;
  border-radius: 999px;
  cursor: help;
  font-size: 11px;
  font-weight: 800;
}

input,
select,
textarea {
  width: 100%;
  padding: 11px 13px;
  background: #fff;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  font: inherit;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

input:hover,
select:hover,
textarea:hover {
  border-color: #b9c2d1;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  font-weight: 700;
  font-size: 14px;
}

.checkbox-field input {
  width: auto;
}

textarea {
  resize: vertical;
  line-height: 1.5;
}

button,
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 10px 18px;
  background: var(--primary);
  color: #fff;
  border: 0;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  transition: background-color 0.12s ease, box-shadow 0.12s ease, transform 0.05s ease;
}

button:hover,
.button:hover {
  background: var(--primary-dark);
  box-shadow: var(--shadow-md);
}

button:active,
.button:active {
  transform: translateY(1px);
}

.button-secondary {
  background: var(--surface-muted);
  color: var(--text);
  border: 1px solid var(--border-strong);
  box-shadow: none;
}

.button-secondary:hover {
  background: #eef1f6;
  box-shadow: none;
}

.link-button {
  display: inline;
  min-height: auto;
  padding: 0;
  background: transparent;
  color: var(--primary);
  border: 0;
  border-radius: 0;
  box-shadow: none;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
}

.link-button:hover {
  background: transparent;
  color: var(--primary-dark);
  box-shadow: none;
}

.alert-error {
  margin-bottom: 16px;
  padding: 12px 14px;
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-sm);
  color: var(--danger-text);
  font-weight: 600;
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
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.dashboard-shell {
  width: min(100%, 1380px);
}

.dashboard-filters {
  margin-bottom: 18px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.kpi-card {
  position: relative;
  display: grid;
  gap: 8px;
  padding-left: 22px;
  overflow: hidden;
}

.kpi-card::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--primary);
  content: '';
}

.kpi-card span {
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.kpi-card strong {
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.01em;
}

.kpi-card p {
  margin-bottom: 0;
}

.alert-list {
  display: grid;
  gap: 10px;
}

.alert-list div {
  padding: 12px 14px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: var(--radius-sm);
}

.bar-track {
  display: inline-flex;
  width: min(180px, 100%);
  height: 8px;
  margin-right: 8px;
  overflow: hidden;
  background: #e7ebf2;
  border-radius: 999px;
  vertical-align: middle;
}

.bar-track span {
  display: block;
  background: var(--primary);
  border-radius: inherit;
}

.panel > summary {
  cursor: pointer;
  font-size: 18px;
  font-weight: 800;
}

.panel > summary + * {
  margin-top: 16px;
}

.empty-state {
  padding: 28px;
  text-align: center;
  background: var(--card);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
}

.empty-state h2 {
  margin-bottom: 6px;
}

.empty-state .button,
.empty-state .actions {
  margin-top: 6px;
}

.form-sections {
  display: grid;
  gap: 12px;
}

.form-section {
  padding: 0;
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: box-shadow 0.12s ease;
}

.form-section[open] {
  box-shadow: var(--shadow-sm);
}

.form-section summary {
  padding: 16px 18px;
  cursor: pointer;
  font-size: 17px;
  font-weight: 800;
  list-style: none;
}

.form-section summary::-webkit-details-marker {
  display: none;
}

.form-section summary::after {
  float: right;
  color: var(--muted);
  font-weight: 400;
  content: '+';
}

.form-section[open] summary::after {
  content: '\\2212';
}

.form-section summary span {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 13.5px;
  font-weight: 400;
}

.form-section-body {
  padding: 4px 18px 18px;
  border-top: 1px solid var(--border);
}

.form-section-flow summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}

.form-section-flow summary span:not(.flow-badge) {
  flex-basis: 100%;
  margin-top: 0;
}

.flow-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: var(--primary-soft);
  color: var(--primary-dark);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
}

.flow-intro {
  margin: 0 2px 4px;
  color: var(--muted);
  font-size: 13.5px;
}

.locked-prompt {
  padding: 14px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.locked-prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.locked-prompt-header label {
  font-size: 14px;
}

.locked-prompt-header span {
  padding: 4px 9px;
  background: var(--primary-soft);
  color: var(--primary-dark);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.locked-prompt pre {
  max-height: 260px;
  margin: 10px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.template-vars {
  padding: 14px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.template-vars strong {
  display: block;
  margin-bottom: 6px;
}

.template-vars ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.template-vars li {
  display: grid;
  gap: 2px;
  padding: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.template-vars code {
  color: var(--primary-dark);
  font-weight: 800;
}

.tabs-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.tabs-inline a {
  padding: 8px 13px;
  background: var(--surface-muted);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  text-decoration: none;
  transition: background-color 0.12s ease, color 0.12s ease;
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
  background: #10162a;
  color: #dbe2f0;
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.run-output {
  max-height: 220px;
  overflow: auto;
  font-size: 12px;
}

.table-wrap {
  overflow-x: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  font-size: 14.5px;
}

th {
  background: var(--surface-muted);
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

tbody tr {
  transition: background-color 0.1s ease;
}

tbody tr:hover {
  background: var(--surface-muted);
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
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 800;
}

.status-on {
  background: #dcfce7;
  color: #166534;
}

.status-off {
  background: #eef1f6;
  color: #475569;
}

.status-warn {
  background: #fef3c7;
  color: #92400e;
}

.status-danger {
  background: var(--danger-bg);
  color: var(--danger-text);
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
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
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
    padding: 22px 16px 36px;
  }

  .kpi-card strong {
    font-size: 26px;
  }
}
`;

export function registerAssetsRoutes(app: FastifyInstance): void {
  app.get('/styles.css', async (_request, reply) => reply.type('text/css').send(styles));
}
