// Zugriffsprotokoll der API (eine Zeile je Anfrage auf stdout → docker compose logs api):
//   [http] POST /api/status/[token]/withdraw 200 14ms nutzer=-
// Bewusst ohne personenbezogene Daten: keine Bodys, keine Header, keine Cookies, keine IP-Adressen,
// keine Query-Strings (werden ganz abgeschnitten). Der Status-Token im Pfad wird nach derselben Regel
// wie im nginx-Access-Log durch [token] ersetzt. Angemeldete Nutzer erscheinen nur mit ihrer ID.
// Erfolgreiche Healthchecks (alle 5 s von Docker) werden nicht protokolliert.

const TOKEN_IN_PATH = /^(\/(?:api\/)?status\/)[^/]+/;

export function maskPath(originalUrl) {
  const path = originalUrl.split('?')[0];
  return path.replace(TOKEN_IN_PATH, '$1[token]');
}

export function requestLog(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const path = maskPath(req.originalUrl);
    if (path === '/api/health' && res.statusCode === 200) return;
    const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const userId = req.user?.id ?? req.session?.userId ?? '-';
    console.log(`[http] ${req.method} ${path} ${res.statusCode} ${ms}ms nutzer=${userId}`);
  });
  next();
}
