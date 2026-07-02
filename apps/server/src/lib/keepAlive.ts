import https from 'https';

export function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url || process.env.NODE_ENV !== 'production') return;

  setInterval(() => {
    https.get(`${url}/health`, (res) => {
      console.log(`[KeepAlive] Ping status: ${res.statusCode}`);
      res.resume(); // Consume response data to free memory/socket
    }).on('error', (err) => {
      console.error('[KeepAlive] Ping failed:', err.message);
    });
  }, 13 * 60 * 1000); // every 13 minutes

  console.log('[KeepAlive] Started — pinging every 13 minutes');
}
