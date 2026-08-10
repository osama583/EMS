import type { MockAuthRecord } from '../app/core/auth/mock-users';

export const environment = {
  production: true,
  enableMockAuth: false,
  useMockRequestOptions: false,
  requestOptionsApiUrl: '/api/request-options',
  useMockAdminDirectory: false,
  adminDirectoryApiUrl: '/api/admin',
  useMockStaffTasks: false,
  staffTasksApiUrl: '/api/staff-tasks',
  useMockEventEngagement: false,
  eventEngagementApiUrl: '/api/event-engagement',
  useMockProposalWorkflow: false,
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  mockUsers: [] as readonly MockAuthRecord[],
} as const;
