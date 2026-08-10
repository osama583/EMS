// Seeds event_category and event_requirements tables.
//
// event_requirements.requirement_name uses the same camelCase-ish tokens as
// Angular's DepartmentRequestKind / requirement keys ('logistics', 'fmb', etc.),
// NOT separate 'waterLogo'/'waterNormal' rows — water requests are line items
// under the 'fmb' requirement per Phase 1's correction.

module.exports = function seedCategories(db, nextId) {
  const categoryNames = [
    'Academic & Career',
    'Workshops & Training',
    'Sports & Wellness',
    'Culture & Community',
    'Clubs & Societies',
    'Entertainment & Social',
    'Volunteering',
  ];
  for (const name of categoryNames) {
    db.event_category.push({ event_category_id: nextId('event_category'), name, active: true });
  }

  const requirementNames = [
    'logistics',
    'transportation',
    'photoVideo',
    'soundLight',
    'fmb',
    'campusTour',
    'fundingPurchase',
  ];
  for (const name of requirementNames) {
    db.event_requirements.push({ requirement_id: nextId('event_requirements'), requirement_name: name });
  }
};
