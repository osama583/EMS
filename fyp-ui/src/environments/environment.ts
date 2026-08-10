import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  requestOptionsApiUrl: '/api/request-options',
  adminDirectoryApiUrl: '/api/admin',
  staffTasksApiUrl: '/api/staff-tasks',
  useMockEventEngagement: true,
  eventEngagementApiUrl: '/api/event-engagement',
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  mockUsers: MOCK_AUTH_USERS,
} as const;
