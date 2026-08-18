// Local development. `ng serve` proxies /api to the Flask backend on port 5000
// (see proxy.conf.json), so a relative base URL avoids CORS entirely in dev.
export const environment = {
  production: false,
  apiBaseUrl: '/api/v1',
} as const;
