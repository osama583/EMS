import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  useMockRequestOptions: true,
  requestOptionsApiUrl: '/api/request-options',
  useMockAdminDirectory: true,
  adminDirectoryApiUrl: '/api/admin',
  useMockStaffTasks: true,
  staffTasksApiUrl: '/api/staff-tasks',
  useMockEventEngagement: true,
  eventEngagementApiUrl: '/api/event-engagement',
  useMockProposalWorkflow: true,
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  mockUsers: MOCK_AUTH_USERS,
} as const;
