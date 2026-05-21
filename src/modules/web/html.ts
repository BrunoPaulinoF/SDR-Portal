export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface LayoutOptions {
  title: string;
  body: string;
}

export function renderLayout({ title, body }: LayoutOptions): string {
  const pageTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${pageTitle}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>${body}</body>
</html>`;
}
