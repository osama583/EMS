import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  authApiUrl: '/api/auth',
  requestOptionsApiUrl: '/api/request-options',
  adminDirectoryApiUrl: '/api/admin',
  staffTasksApiUrl: '/api/staff-tasks',
  eventsApiUrl: '/api/events',
  eventEngagementApiUrl: '/api/event-engagement',
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  configApiUrl: '/api/config',
  imageUploadApiUrl: '/api/uploads',
  mockUsers: MOCK_AUTH_USERS,
} as const;
