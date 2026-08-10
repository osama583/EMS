// Seeds all Manager-Configured Options tables — the request-option catalogs
// Angular's request-option.service.ts fetches (logistics, transportation,
// photo/video, sound/light, dietary info, serving unit, F&B menu items,
// campus tour starting points, water logo/normal, funding main/sub).
//
// Source of truth: fyp-ui/src/app/core/request-options/request-option.mock-data.ts
// as it existed before commit 8733adb ("refactor: collapse Mock/Api repository
// pairs to Api-only") deleted it in favor of a real HTTP-backed repository.
// That file's content (recovered via `git show 8da8a2c^:...`) is transcribed
// here verbatim, with the two corrections commit 8da8a2c already made to it
// applied: `fnb` kind renamed to `fmb`, and the `campusTourArea`/`campusTourMap`
// kinds (and their options) dropped — those tables don't exist in the
// corrected schema (Task 1.1 dropped campus_tour_area_options /
// campus_tour_map_options, 51 tables -> 49).
//
// Requires seed-categories.js (db.event_requirements) and seed-cafeteria.js
// (db.cafeteria) to have already run.

module.exports = function seedOptions(db, nextId) {
  const requirementId = (name) => db.event_requirements.find((r) => r.requirement_name === name).requirement_id;

  // --- logistics_options ---
  db.logistics_options.push(
    {
      logistics_option_id: nextId('logistics_options'),
      requirement_id: requirementId('logistics'),
      label: 'Registration table',
      description: 'For guest registration and check-in.',
      active: true,
      available_quantity: 1,
      quantity_unit: 'table',
      item_image_url:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Registration Table</text></svg>',
    },
    {
      logistics_option_id: nextId('logistics_options'),
      requirement_id: requirementId('logistics'),
      label: 'Chairs',
      description: null,
      active: true,
      available_quantity: 200,
      quantity_unit: 'chair',
      item_image_url:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Event Chairs</text></svg>',
    },
    {
      logistics_option_id: nextId('logistics_options'),
      requirement_id: requirementId('logistics'),
      label: 'Banquet tables',
      description: null,
      active: true,
      available_quantity: 20,
      quantity_unit: 'table',
      item_image_url: null,
    },
    {
      logistics_option_id: nextId('logistics_options'),
      requirement_id: requirementId('logistics'),
      label: 'Directional standees',
      description: null,
      active: true,
      available_quantity: 10,
      quantity_unit: 'standee',
      item_image_url: null,
    },
    {
      logistics_option_id: nextId('logistics_options'),
      requirement_id: requirementId('logistics'),
      label: 'Stage riser',
      description: null,
      active: true,
      available_quantity: 4,
      quantity_unit: 'section',
      item_image_url: null,
    },
    {
      logistics_option_id: nextId('logistics_options'),
      requirement_id: requirementId('logistics'),
      label: 'Queue barriers',
      description: null,
      active: true,
      available_quantity: 16,
      quantity_unit: 'barrier',
      item_image_url: null,
    },
  );

  // --- transportation_options ---
  db.transportation_options.push(
    {
      transportation_option_id: nextId('transportation_options'),
      requirement_id: requirementId('transportation'),
      label: 'University van',
      description: null,
      active: true,
      passenger_capacity: 10,
      available_vehicle_count: 3,
      instructions: null,
      vehicle_image_url:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23ebf8ff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">University Van</text></svg>',
    },
    {
      transportation_option_id: nextId('transportation_options'),
      requirement_id: requirementId('transportation'),
      label: 'Chartered bus',
      description: null,
      active: true,
      passenger_capacity: 44,
      available_vehicle_count: 2,
      instructions: null,
      vehicle_image_url:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23e6fffa"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23234e52">Chartered Bus</text></svg>',
    },
    {
      transportation_option_id: nextId('transportation_options'),
      requirement_id: requirementId('transportation'),
      label: 'Grab voucher',
      description: 'Capacity is per vehicle.',
      active: true,
      passenger_capacity: 4,
      available_vehicle_count: 20,
      instructions: null,
      vehicle_image_url: null,
    },
    {
      transportation_option_id: nextId('transportation_options'),
      requirement_id: requirementId('transportation'),
      label: 'VIP car',
      description: null,
      active: true,
      passenger_capacity: 4,
      available_vehicle_count: 2,
      instructions: null,
      vehicle_image_url: null,
    },
    {
      transportation_option_id: nextId('transportation_options'),
      requirement_id: requirementId('transportation'),
      label: 'Airport pickup',
      description: null,
      active: true,
      passenger_capacity: 6,
      available_vehicle_count: 2,
      instructions: null,
      vehicle_image_url: null,
    },
  );

  // --- media_options (photoVideo) ---
  db.media_options.push(
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Photographer', description: null, active: true, max_personnel: 4 },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Videographer', description: null, active: true, max_personnel: 4 },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Photo and video team', description: null, active: true, max_personnel: 8 },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Livestream support', description: null, active: true, max_personnel: 5 },
  );

  // --- sound_light_options ---
  // technical_description is NOT NULL in the schema; the source Angular mock
  // data has no equivalent field for these rows, so a short generic setup
  // note is supplied for each (mock-layer filler, not sourced from Angular).
  db.sound_light_options.push(
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Wireless microphone', description: null, active: true, available_quantity: 12, technical_description: 'Handheld or lapel, standard venue setup.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'PA system', description: null, active: true, available_quantity: 4, technical_description: 'Standard public-address setup for mid-size venues.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Projector support', description: null, active: true, available_quantity: 8, technical_description: 'Includes screen and standard HDMI/VGA connectors.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Stage lighting', description: null, active: true, available_quantity: 3, technical_description: 'Basic wash and spot lighting rig.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'LED screen', description: null, active: true, available_quantity: 2, technical_description: 'Modular LED wall panels, setup crew required.' },
  );

  // --- serving_unit_options (seed BEFORE fmb_options, which references it) ---
  const servingUnitIdMap = {};
  const servingUnitSeeds = [
    ['serving-pax', 'Per pax', 'One serving for one person.'],
    ['serving-set', 'Per set', null],
    ['serving-tray', 'Per tray', null],
    ['serving-piece', 'Per piece', null],
    ['serving-bottle', 'Per bottle', null],
  ];
  for (const [oldId, label, description] of servingUnitSeeds) {
    const row = { serving_unit_option_id: nextId('serving_unit_options'), label, description, active: true };
    db.serving_unit_options.push(row);
    servingUnitIdMap[oldId] = row.serving_unit_option_id;
  }

  // --- dietary_information_options (seed BEFORE fmb_options) ---
  const dietaryIdMap = {};
  const dietarySeeds = [
    ['dietary-standard', 'Standard menu', 'No special dietary classification.'],
    ['dietary-vegetarian', 'Vegetarian', null],
    ['dietary-vegan', 'Vegan', null],
    ['dietary-gluten-free', 'Gluten-free', null],
    ['dietary-allergen-aware', 'Allergen-aware', 'Confirm the specific allergen requirements before ordering.'],
  ];
  for (const [oldId, label, description] of dietarySeeds) {
    const row = { dietary_information_option_id: nextId('dietary_information_options'), label, description, active: true };
    db.dietary_information_options.push(row);
    dietaryIdMap[oldId] = row.dietary_information_option_id;
  }

  // --- fmb_options (references serving_unit_options + dietary_information_options + cafeteria) ---
  // The Angular mock's fmb options aren't cafeteria-scoped (they're generic
  // applicant-facing food type choices); this seed corrects that mock-layer
  // shortcut by splitting the entries across both seeded cafeterias so each
  // cafeteria's "My Menu" has real rows.
  const fmbSeeds = [
    ['food-lunch', 'Lunch', 'serving-pax', 'dietary-standard'],
    ['food-dinner', 'Dinner', 'serving-pax', 'dietary-standard'],
    ['food-refreshments', 'Refreshments', 'serving-pax', 'dietary-standard'],
    ['food-coffee-tea', 'Coffee / Tea', 'serving-pax', 'dietary-standard'],
    ['food-buffet', 'Buffet', 'serving-pax', 'dietary-standard'],
    ['food-other', 'Other', null, null],
  ];
  fmbSeeds.forEach(([oldId, label, servingKey, dietaryKey], index) => {
    db.fmb_options.push({
      fmb_option_id: nextId('fmb_options'),
      requirement_id: requirementId('fmb'),
      cafeteria_id: db.cafeteria[index % db.cafeteria.length].cafeteria_id,
      label,
      description: null,
      active: true,
      serving_unit_option_id: servingKey ? servingUnitIdMap[servingKey] : servingUnitIdMap['serving-pax'],
      dietary_information_option_id: dietaryKey ? dietaryIdMap[dietaryKey] : dietaryIdMap['dietary-standard'],
      availability_ordering_notes: null,
      menu_image_url: null,
    });
  });

  // --- campus_tour_start_options ---
  db.campus_tour_start_options.push(
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Main Lobby', description: null, active: true, meeting_instructions: 'Meet beside the reception desk.', max_group_size: 30 },
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Atrium', description: null, active: true, meeting_instructions: null, max_group_size: 50 },
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Admissions Office', description: null, active: true, meeting_instructions: null, max_group_size: 20 },
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Library Entrance', description: null, active: true, meeting_instructions: null, max_group_size: 25 },
  );

  // --- water_logo_options / water_normal_options ---
  // requirement_id = 'fmb' per Phase 1's correction — water requests attach
  // to the fmb requirement now, not a standalone water requirement.
  const bottleCounts = [24, 48, 96, 120];
  for (const count of bottleCounts) {
    db.water_logo_options.push({
      water_logo_option_id: nextId('water_logo_options'),
      requirement_id: requirementId('fmb'),
      label: `${count} bottles`,
      description: null,
      active: true,
      number_of_bottles: count,
      available_stock: 500,
      logo_branding_requirement: 'APU logo artwork is required.',
      lead_time_ordering_instructions: null,
    });
  }
  db.water_logo_options.push({
    water_logo_option_id: nextId('water_logo_options'),
    requirement_id: requirementId('fmb'),
    label: 'Custom quantity',
    description: null,
    active: true,
    number_of_bottles: 0,
    available_stock: 500,
    logo_branding_requirement: 'APU logo artwork is required.',
    lead_time_ordering_instructions: null,
  });

  for (const count of bottleCounts) {
    db.water_normal_options.push({
      water_normal_option_id: nextId('water_normal_options'),
      requirement_id: requirementId('fmb'),
      label: `${count} bottles`,
      description: null,
      active: true,
      number_of_bottles: count,
      available_stock: 500,
      ordering_delivery_instructions: null,
    });
  }
  db.water_normal_options.push({
    water_normal_option_id: nextId('water_normal_options'),
    requirement_id: requirementId('fmb'),
    label: 'Custom quantity',
    description: null,
    active: true,
    number_of_bottles: 0,
    available_stock: 500,
    ordering_delivery_instructions: null,
  });

  // --- funding_main_options (seed BEFORE funding_sub_options, which references it) ---
  const fundingMainIdMap = {};
  const fundingMainSeeds = [
    ['fund-main-printing', 'Printing and materials', 'PRINT'],
    ['fund-main-venue', 'Venue setup', 'VENUE'],
    ['fund-main-honorarium', 'Honorarium', 'HON'],
    ['fund-main-external', 'External service', 'EXT'],
    ['fund-main-supplies', 'Event supplies', 'SUP'],
  ];
  for (const [oldId, label, financeCode] of fundingMainSeeds) {
    const row = {
      funding_main_option_id: nextId('funding_main_options'),
      requirement_id: requirementId('fundingPurchase'),
      label,
      description: null,
      active: true,
      budget_category_finance_code: financeCode,
      purchasing_guidance: null,
    };
    db.funding_main_options.push(row);
    fundingMainIdMap[oldId] = row.funding_main_option_id;
  }

  // --- funding_sub_options (references funding_main_options; no requirement_id column) ---
  const fundingSubSeeds = [
    ['fund-sub-posters', 'Posters and flyers', 'fund-main-printing'],
    ['fund-sub-certificates', 'Certificates', 'fund-main-printing'],
    ['fund-sub-name-tags', 'Name tags', 'fund-main-printing'],
    ['fund-sub-booklets', 'Programme booklets', 'fund-main-printing'],
    ['fund-sub-furniture', 'Furniture rental', 'fund-main-venue'],
    ['fund-sub-decorations', 'Decorations', 'fund-main-venue'],
    ['fund-sub-backdrop', 'Backdrop production', 'fund-main-venue'],
    ['fund-sub-booth', 'Booth setup', 'fund-main-venue'],
    ['fund-sub-speaker', 'Guest speaker', 'fund-main-honorarium'],
    ['fund-sub-facilitator', 'Facilitator', 'fund-main-honorarium'],
    ['fund-sub-performer', 'Performer', 'fund-main-honorarium'],
    ['fund-sub-judge', 'External judge', 'fund-main-honorarium'],
    ['fund-sub-security', 'Security service', 'fund-main-external'],
    ['fund-sub-cleaning', 'Cleaning service', 'fund-main-external'],
    ['fund-sub-medical', 'Medical support', 'fund-main-external'],
    ['fund-sub-contractor', 'Technical contractor', 'fund-main-external'],
    ['fund-sub-kits', 'Participant kits', 'fund-main-supplies'],
    ['fund-sub-stationery', 'Stationery', 'fund-main-supplies'],
    ['fund-sub-prizes', 'Prizes and tokens', 'fund-main-supplies'],
    ['fund-sub-consumables', 'Consumable supplies', 'fund-main-supplies'],
  ];
  for (const [oldId, label, parentOldId] of fundingSubSeeds) {
    db.funding_sub_options.push({
      funding_sub_option_id: nextId('funding_sub_options'),
      main_option_id: fundingMainIdMap[parentOldId],
      label,
      description: null,
      active: true,
      finance_procurement_code: null,
      default_unit_purchasing_note: null,
    });
  }
};
