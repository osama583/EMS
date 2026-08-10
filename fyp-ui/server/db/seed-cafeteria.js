// Seeds cafeteria + cafeteria_assignment tables. Requires seed-users.js to have run
// first (looks up cafeteria-manager/cafeteria-staff/cafeteria-admin role users).

module.exports = function seedCafeteria(db, nextId) {
  const cafeteria1 = { cafeteria_id: nextId('cafeteria'), name: 'Atrium Cafeteria', active: true };
  const cafeteria2 = { cafeteria_id: nextId('cafeteria'), name: 'Level 3 Food Court', active: true };
  db.cafeteria.push(cafeteria1, cafeteria2);

  const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
  const cafeteriaStaffUsers = db.users.filter((u) => u.role === 'cafeteria-staff');
  const cafeteriaAdmin = db.users.find((u) => u.role === 'cafeteria-admin');

  if (cafeteriaManager) {
    db.cafeteria_assignment.push(
      {
        cafeteria_assignment_id: nextId('cafeteria_assignment'),
        cafeteria_id: cafeteria1.cafeteria_id,
        user_id: cafeteriaManager.user_id,
        assignment_role: 'manager',
        assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null,
        assigned_at: new Date().toISOString(),
      },
      {
        cafeteria_assignment_id: nextId('cafeteria_assignment'),
        cafeteria_id: cafeteria2.cafeteria_id,
        user_id: cafeteriaManager.user_id,
        assignment_role: 'manager',
        assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null,
        assigned_at: new Date().toISOString(),
      },
    );
  }

  // Assign every cafeteria-staff user to cafeteria1 so multiple staff are eligible
  // to claim the same shared-inbox task (Task 3.6's demo scenario).
  for (const staff of cafeteriaStaffUsers) {
    db.cafeteria_assignment.push({
      cafeteria_assignment_id: nextId('cafeteria_assignment'),
      cafeteria_id: cafeteria1.cafeteria_id,
      user_id: staff.user_id,
      assignment_role: 'staff',
      assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null,
      assigned_at: new Date().toISOString(),
    });
  }
};
