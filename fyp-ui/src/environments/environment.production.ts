// Production. Set to the deployed API's absolute origin; it must appear in the
// backend's CORS_ORIGINS allow-list.
export const environment = {
  production: true,
  apiBaseUrl: '/api/v1',
} as const;
