// Local development. `ng serve` proxies /api to the Flask backend on port 5000
// (see proxy.conf.json), so a relative base URL avoids CORS entirely in dev.
//
// That proxy targets 127.0.0.1 rather than localhost on purpose: Node resolves
// localhost to the IPv6 loopback (::1) first, while the Flask dev server binds
// only the IPv4 one, so every proxied call fails with ECONNREFUSED ::1:5000.
export const environment = {
  production: false,
  apiBaseUrl: '/api/v1',
} as const;
