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

/* Caixa de conversas: painel de duas colunas no espirito do WhatsApp Web. */
.app-shell-inbox {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: none;
  height: 100vh;
  padding: 24px 24px 22px;
}

.inbox-topbar {
  margin-bottom: 16px;
}

.inbox-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.inbox-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inbox-picker label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.inbox-picker select {
  min-width: 190px;
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--card);
  font: inherit;
}

.inbox-refresh {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.whatsapp-shell {
  display: grid;
  grid-template-columns: minmax(250px, 330px) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.chat-search {
  padding: 14px 14px 8px;
}

.chat-search-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.chat-search input {
  width: 100%;
  padding: 10px 14px;
  background: var(--surface-muted);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font: inherit;
}

.chat-list-note {
  margin: 0;
  padding: 2px 16px 8px;
  font-size: 12.5px;
}

.chat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--border);
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  color: inherit;
  text-decoration: none;
}

.chat-item[hidden] {
  display: none;
}

.chat-item:hover {
  background: var(--surface-muted);
}

.chat-item-active,
.chat-item-active:hover {
  background: var(--primary-soft);
}

.chat-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 42px;
  height: 42px;
  background: #dcf8c6;
  border-radius: 50%;
  color: #14532d;
  font-size: 14px;
  font-weight: 800;
}

.chat-item-main {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.chat-item-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.chat-item-title,
.chat-item-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-item-title {
  font-size: 14.5px;
  font-weight: 700;
}

.chat-item-time {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 11.5px;
}

.chat-item-preview {
  color: var(--muted);
  font-size: 13px;
}

.chat-item-flag {
  flex: 0 0 auto;
  padding: 1px 8px;
  background: #dcf8c6;
  border-radius: 999px;
  color: #14532d;
  font-size: 11px;
  font-weight: 800;
}

.chat-list-empty {
  margin: 0;
  padding: 18px 16px;
  font-size: 13px;
}

.chat-thread {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #efeae2;
}

.chat-thread-empty {
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}

.chat-thread-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}

.chat-thread-identity {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.chat-thread-identity strong {
  font-size: 15.5px;
}

.chat-thread-identity p {
  margin: 0;
  font-size: 12.5px;
}

.chat-thread-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.chat-thread-tags .button {
  padding: 7px 12px;
  font-size: 13px;
}

.chat-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  padding: 18px 22px 24px;
  overflow-y: auto;
}

.chat-day {
  align-self: center;
  margin: 10px 0 4px;
}

.chat-day span {
  display: inline-block;
  padding: 3px 12px;
  background: rgb(255 255 255 / 85%);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.chat-bubble {
  display: flex;
  flex-direction: column;
  max-width: min(560px, 78%);
  padding: 8px 12px 6px;
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
  font-size: 14.5px;
}

.chat-bubble-in {
  align-self: flex-start;
  background: #fff;
  border-top-left-radius: 2px;
}

.chat-bubble-out {
  align-self: flex-end;
  background: #d9fdd3;
  border-top-right-radius: 2px;
}

.chat-bubble-tags {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 3px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.chat-bubble-author {
  color: #0f766e;
}

.chat-bubble-kind {
  color: var(--muted);
}

.chat-bubble-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-bubble-time {
  align-self: flex-end;
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
}

.chat-hidden-note,
.chat-empty-thread {
  align-self: center;
  margin: 4px 0 8px;
  font-size: 12.5px;
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

  .app-shell-inbox {
    height: auto;
    padding: 22px 16px 36px;
  }

  .whatsapp-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-panel {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .chat-list {
    max-height: 320px;
  }

  .chat-thread-top {
    flex-wrap: wrap;
  }

  .chat-thread-tags {
    width: 100%;
  }

  .chat-scroll {
    max-height: 65vh;
    padding: 16px 14px 20px;
  }

  .chat-bubble {
    max-width: 88%;
  }
}

.qr-panel { display: flex; flex-direction: column; gap: 1.25rem; align-items: flex-start; }
.qr-box { display: flex; flex-direction: column; gap: 0.75rem; align-items: center; padding: 1.25rem; background: #fff; border-radius: 12px; border: 1px solid var(--border, #e2e8f0); align-self: center; }
.qr-box svg, .qr-box img { width: 288px; height: 288px; display: block; }
.qr-connected { border-color: #16a34a; }
.qr-status-ok { color: #16a34a; font-weight: 600; font-size: 1.1rem; margin: 0; }
.qr-steps { margin: 0; padding-left: 1.25rem; line-height: 1.7; }
.qr-steps li { margin-bottom: 0.25rem; }
.share-box { display: flex; flex-direction: column; gap: 0.5rem; }
.share-input { width: 100%; padding: 0.6rem 0.75rem; font-family: ui-monospace, monospace; font-size: 0.85rem; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; }
.public-connect { max-width: 620px; margin: 0 auto; padding: 2rem 1rem; }
.diagnostic-list { display: grid; grid-template-columns: minmax(140px, auto) 1fr; gap: 0.35rem 1rem; margin: 0.75rem 0; font-size: 0.9rem; }
.diagnostic-list dt { font-weight: 600; color: var(--muted, #64748b); }
.diagnostic-list dd { margin: 0; word-break: break-word; }
.diagnostic-raw { background: #0f172a; color: #e2e8f0; padding: 0.75rem 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.8rem; margin: 0; }

.connection-summary { padding: 1rem 1.1rem; background: #f8fafc; border: 1px solid var(--border, #e2e8f0); border-radius: 10px; display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
.connection-summary p { margin: 0; }
.advanced-block { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 0.75rem 1rem; }
.advanced-block summary { cursor: pointer; font-weight: 600; }
.advanced-block > * { margin-top: 0.75rem; }

.link-danger { color: #b91c1c; }
`;

export function registerAssetsRoutes(app: FastifyInstance): void {
  app.get('/styles.css', async (_request, reply) => reply.type('text/css').send(styles));
}
