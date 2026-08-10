import type { MockAuthRecord } from '../app/core/auth/mock-users';

export const environment = {
  production: true,
  enableMockAuth: false,
  authApiUrl: '/api/auth',
  useMockRequestOptions: false,
  requestOptionsApiUrl: '/api/request-options',
  useMockAdminDirectory: false,
  adminDirectoryApiUrl: '/api/admin',
  useMockStaffTasks: false,
  staffTasksApiUrl: '/api/staff-tasks',
  eventsApiUrl: '/api/events',
  useMockEventEngagement: false,
  eventEngagementApiUrl: '/api/event-engagement',
  useMockProposalWorkflow: false,
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  configApiUrl: '/api/config',
  mockUsers: [] as readonly MockAuthRecord[],
} as const;
