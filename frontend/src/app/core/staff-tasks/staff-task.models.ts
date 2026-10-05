// `role` on the wire is a routing key, not a UserRole: for the 5 Service department-routed requirement
// kinds it's the unit's own unitCode (see department-workflow.config.ts's UNIT_DEPARTMENT_WORKFLOWS
// unitCode values); for the flat-routed kind it stays a flat role string ('cafeteria-staff' for the
// F&B cafeteria fan-out).
export type StaffTaskRoutingKey = string;
