import { EditableRow } from '../../shared/components/form-controls/form-controls.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalDepartmentKey, ProposalDepartmentRequest, ProposalReviewRecord } from './proposal-review.models';
import { ProposalStage, ProposalWorkflowState, initialWorkflowState } from './proposal-status.models';

const REQUEST_DETAILS: Readonly<Record<ProposalDepartmentKey, readonly Omit<ProposalDepartmentRequest, 'id' | 'department'>[]>> = {
  campusTour: [{ item: 'Campus overview tour', quantity: '30 visitors', schedule: '8 Aug 2026 - 3:00 PM-4:00 PM', location: 'Main Lobby', notes: 'Include innovation labs and student spaces.' }],
  waterLogo: [{ item: 'Mineral Water with APU Logo', quantity: '180 bottles', schedule: 'Required by 8 Aug 2026 - 3:00 PM', location: 'Atrium', notes: 'Deliver before guest registration opens.' }],
  waterNormal: [{ item: 'Mineral Water Normal', quantity: '96 bottles', schedule: 'Required by 8 Aug 2026 - 3:00 PM', location: 'Atrium', notes: 'Place at volunteer and backstage stations.' }],
  logistics: [{ item: 'Banquet chairs and registration tables', quantity: '180 chairs · 8 tables', schedule: '8 Aug 2026 · 1:00 PM–3:30 PM', location: 'Atrium', notes: 'Complete setup before vendor arrival.' }],
  soundLight: [{ item: 'Main-stage sound and lighting', quantity: '1 complete setup', schedule: '8 Aug 2026 · 2:00 PM–10:00 PM', location: 'Atrium stage', notes: 'Wireless microphones, digital mixer and stage wash.' }],
  photoVideo: [{ item: 'Photography and videography coverage', quantity: '2 photographers · 1 videographer', schedule: '8 Aug 2026 · 4:00 PM–10:00 PM', location: 'Atrium', notes: 'Cover performances, guests and awards presentation.' }],
  transportation: [{ item: 'Campus shuttle', quantity: '28 pax · 40-seat bus', schedule: '8 Aug 2026 · 3:00 PM–10:30 PM', location: 'APU Residence ↔ Campus', notes: 'Two scheduled pickup windows.' }],
  fnb: [{ item: 'International buffet service', quantity: '180 meals', schedule: '8 Aug 2026 · 6:00 PM–8:00 PM', location: 'Atrium dining zone', notes: 'Halal and vegetarian selections required.' }],
  fundingPurchase: [{ item: 'Event materials and participant kits', quantity: '180 kits', schedule: 'Required by 6 Aug 2026', location: 'Student Affairs', notes: 'Estimated total RM 3,600.' }],
};

// Every seed proposal requests the same representative set of departments so each mock record
// exercises the full multi-department review flow; totalPax (per-proposal) decides whether the
// F&B-reviewer/CFO stages apply.
const SELECTED_REQUIREMENTS: readonly DepartmentRequestKind[] = ['logistics', 'fnb', 'photoVideo'];

const requests = (seed: number): readonly ProposalDepartmentRequest[] =>
  SELECTED_REQUIREMENTS.map((department, index) => ({ id: seed * 10 + index, department, ...REQUEST_DETAILS[department][0] }));

const coOwnersFor = (applicant: string): readonly EditableRow[] => [
  { id: 1, name: applicant, email: `${applicant.toLowerCase().replace(/\s+/g, '.')}@student.apu.edu.my`, role: 'Lead Organiser' },
];

const organizersFor = (applicant: string): readonly EditableRow[] => [
  { id: 1, name: applicant, email: `${applicant.toLowerCase().replace(/\s+/g, '.')}@student.apu.edu.my`, role: 'Event Lead', notes: 'Primary point of contact.' },
  { id: 2, name: 'Jordan Lee', email: 'jordan.lee@student.apu.edu.my', role: 'Logistics Coordinator', notes: 'Handles on-the-day setup.' },
];

const IMPORTANT_PEOPLE: readonly EditableRow[] = [
  { id: 1, name: 'Dr. Wan Aziz', type: 'Speaker', organization: 'APU', designation: 'Dean of Student Affairs' },
];

const GUESTS: readonly EditableRow[] = [
  { id: 1, guestType: 'Students', count: 150, notes: 'General admission.' },
  { id: 2, guestType: 'Industry Partners', count: 10, notes: 'Invited sponsors.' },
];

const AGENDA: readonly EditableRow[] = [
  { id: 1, time: '16:00', activity: 'Doors open & registration', location: 'Atrium', pic: 'Jordan Lee', notes: '' },
  { id: 2, time: '17:00', activity: 'Opening remarks', location: 'Atrium Stage', pic: 'Dr. Wan Aziz', notes: '' },
  { id: 3, time: '20:00', activity: 'Closing & thank you', location: 'Atrium Stage', pic: 'Event Lead', notes: '' },
];

const DISCUSSIONS: readonly EditableRow[] = [
  { id: 1, topic: 'Confirm halal catering certification with vendor.' },
];

const SCHEDULE_ROWS = (schedule: string): readonly EditableRow[] => [
  { id: 1, date: schedule.split(' · ')[0] ?? schedule, start: '16:00', end: '22:00', location: schedule.split(' · ').at(-1) ?? '' },
];

const proposal = (
  id: number,
  proposalId: string,
  eventTitle: string,
  applicant: string,
  schedule: string,
  shortIntroduction: string,
  goals: string,
  benefits: string,
  totalPax: number,
  workflow: ProposalWorkflowState,
  category: string,
): ProposalReviewRecord => ({
  id,
  proposalId,
  eventTitle,
  applicant,
  applicantInitials: applicant.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
  schedule,
  shortIntroduction,
  goals,
  benefits,
  totalPax,
  status: workflowStatusLabel(workflow),
  category,
  requests: requests(id),
  applicantEmail: `${applicant.toLowerCase().replace(/\s+/g, '.')}@student.apu.edu.my`,
  applicantDepartment: 'School of Computing',
  coOwners: coOwnersFor(applicant),
  organizers: organizersFor(applicant),
  importantPeople: IMPORTANT_PEOPLE,
  guests: GUESTS,
  agenda: AGENDA,
  discussions: DISCUSSIONS,
  scheduleRows: SCHEDULE_ROWS(schedule),
  eventImage: null,
  eventVisibility: 'Public',
  eventCategories: [category],
  eventFormat: 'On Campus',
  registrationMode: 'Approval Required',
  publicity: 'Promoted via campus posters and the APU Events app.',
  selectedRequirements: SELECTED_REQUIREMENTS,
  externalPax: Math.round(totalPax * 0.1),
  workflow,
});

function workflowStatusLabel(workflow: ProposalWorkflowState): string {
  switch (workflow.stage) {
    case ProposalStage.HosHodReview: return 'HOS/HOD review';
    case ProposalStage.FmbReviewerPending: return 'F&B review';
    case ProposalStage.CfoReview: return 'Additional approval';
    case ProposalStage.DepartmentReview: return 'Department review';
    case ProposalStage.Approved: return 'Approved';
    case ProposalStage.Rejected: return 'Rejected';
    case ProposalStage.NeedsRevision: return 'Revision required';
    default: return 'Submitted';
  }
}

const workflowAt = (stage: ProposalStage, totalPax: number): ProposalWorkflowState => ({
  ...initialWorkflowState(SELECTED_REQUIREMENTS),
  stage,
});

export const PROPOSAL_REVIEW_RECORDS: readonly ProposalReviewRecord[] = [
  proposal(1, 'EVT-260142', 'APU Cultural Night 2026', 'Aina Rahman', '8 Aug 2026 · 4:00 PM–10:00 PM · Atrium', 'An evening celebrating APU’s international community through performances, food and student-led cultural showcases.', 'Strengthen cross-cultural understanding and create a welcoming platform for student communities.', 'Greater student participation, cultural awareness and stronger connections across the university.', 180, workflowAt(ProposalStage.DepartmentReview, 180), 'Culture & Community'),
  proposal(2, 'EVT-260137', 'Future Tech Showcase', 'Daniel Wong', '12 Aug 2026 · 10:00 AM–5:00 PM · Design Studio', 'A showcase of student technology projects, demonstrations and industry conversations.', 'Connect student innovators with peers, academics and industry representatives.', 'Improved project visibility, professional feedback and collaboration opportunities.', 95, workflowAt(ProposalStage.HosHodReview, 95), 'Academic & Career'),
  proposal(3, 'EVT-260129', 'APU Sports Carnival', 'Nur Izzati', '16 Aug 2026 · 8:00 AM–6:00 PM · Sports Centre', 'A university-wide day of team sports, wellness activities and friendly competition.', 'Encourage active lifestyles and collaboration between schools and departments.', 'Improved wellbeing, teamwork and community participation.', 320, workflowAt(ProposalStage.CfoReview, 320), 'Sports & Wellness'),
  proposal(4, 'EVT-260121', 'Career Connections Forum', 'Marcus Lim', '20 Aug 2026 · 1:00 PM–6:00 PM · Auditorium 2', 'A networking forum connecting students with employers and alumni.', 'Help students understand career pathways and build professional networks.', 'Greater career awareness and direct employer engagement.', 140, workflowAt(ProposalStage.FmbReviewerPending, 140), 'Academic & Career'),
  proposal(5, 'EVT-260114', 'Community Volunteer Day', 'Priya Nair', '24 Aug 2026 · 7:30 AM–5:00 PM · Klang', 'A coordinated volunteering programme supporting a local community partner.', 'Create meaningful service-learning opportunities for APU students.', 'Community impact, stronger civic awareness and practical teamwork experience.', 72, workflowAt(ProposalStage.DepartmentReview, 72), 'Volunteering'),
  proposal(6, 'EVT-260082', 'Graduate Networking Evening', 'Sarah Tan', '23 Jul 2026 · 5:00 PM–8:30 PM · Auditorium 2', 'An evening for graduating students to connect with alumni and industry guests.', 'Support graduate employability and professional relationship-building.', 'New career connections and improved confidence in professional networking.', 90, { ...workflowAt(ProposalStage.Approved, 90), departmentConfirmations: initialWorkflowState(SELECTED_REQUIREMENTS).departmentConfirmations.map((entry) => ({ ...entry, confirmed: true })) }, 'Academic & Career'),
  proposal(7, 'EVT-260074', 'Clubs and Societies Fair', 'Amir Hassan', '18 Jul 2026 · 10:00 AM–4:00 PM · Spine', 'A discovery fair introducing students to APU clubs, societies and communities.', 'Increase awareness and membership of student-led organisations.', 'Stronger campus participation and easier access to student communities.', 260, { ...workflowAt(ProposalStage.Approved, 260), departmentConfirmations: initialWorkflowState(SELECTED_REQUIREMENTS).departmentConfirmations.map((entry) => ({ ...entry, confirmed: true })) }, 'Clubs & Societies'),
  proposal(8, 'EVT-260066', 'Wellness Weekend', 'Mei Chen', '12 Jul 2026 · 9:00 AM–5:00 PM · Sports Centre', 'A weekend programme focused on physical and mental wellbeing.', 'Give students practical ways to maintain healthy routines.', 'Improved wellbeing awareness and access to support activities.', 110, { ...workflowAt(ProposalStage.Approved, 110), departmentConfirmations: initialWorkflowState(SELECTED_REQUIREMENTS).departmentConfirmations.map((entry) => ({ ...entry, confirmed: true })) }, 'Sports & Wellness'),
];

export function proposalForTitle(title: string, fallbackId = 1000): ProposalReviewRecord {
  return (
    PROPOSAL_REVIEW_RECORDS.find((record) => record.eventTitle === title) ??
    proposal(fallbackId, `EVT-${String(fallbackId).padStart(6, '0')}`, title, 'APU Applicant', 'Schedule pending', 'Event proposal information submitted for review.', 'Deliver the planned event successfully.', 'Provide a valuable experience for the APU community.', 0, workflowAt(ProposalStage.HosHodReview, 0), 'General')
  );
}
