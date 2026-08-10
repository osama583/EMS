-- ============================================================================
-- APU Event Management System (EMS) — Database Schema (v2)
-- ============================================================================
-- Dialect: PostgreSQL. Port to MySQL 8+ by swapping BIGSERIAL -> BIGINT
-- AUTO_INCREMENT and now() -> CURRENT_TIMESTAMP.
--
-- CHANGES IN THIS VERSION (vs. the previous file):
--   - Every table's primary key is now named <table>_id, not a bare `id`.
--   - Dropped the "add a username column" idea — user_id + email is the
--     login/identity story, per your instruction.
--   - Dropped request.applicant_staff_username entirely — it had no source
--     column anywhere once the username idea was dropped.
--   - Renamed request.applicant_department -> applicant_department_or_school
--     (students can apply now too, and students have a school, not a dept).
--   - Added is_active to `users` and `unit`.
--   - Renamed staff's PK: id -> staff_id.
--   - Removed cafeteria.location.
--   - Full rebuild of the manager-options tables using your real field list:
--     one dedicated table per dropdown "page" instead of a shared generic
--     shape, because the real fields differ too much between pages to
--     merge cleanly.
--   - fnb_options is now "My Menu" — scoped to a specific cafeteria via
--     cafeteria_id, with FKs into two new shared lookup tables
--     (dietary_information_options, serving_unit_options).
--   - request_fnb_selection now properly FKs into fnb_options (the real
--     menu item) instead of a free-text guess.
--   - request_fnb.quantity renamed to pax (it's "how many people", not a
--     quantity of food units).
--   - Added cafeteria_admin / cafeteria_manager / cafeteria_staff roles,
--     and a cafeteria_assignment bridge table (a manager/staff can run
--     more than one cafeteria; Cafeteria Admin makes the assignment).
--   - Added config row MAX_EVENT_CATEGORIES (admin-settable, same table
--     used for the pax threshold and cancellation deadline).
--   - Added request.max_pax (organizer-set registration capacity cap —
--     ASSUMPTION, flag if this isn't what you meant).
--   - event_registration expanded: registrant_name, registrant_email,
--     reason_for_attending (used only when registration_approval='manual').
--   - Fixed event_registration's unique constraint so cancelling and
--     re-registering is actually possible (partial unique index).
--
-- STILL AN OPEN QUESTION (see chat message):
--   campus_tour_start/area/map — built as 3 separate tables based on your
--   detailed field list, even though an earlier line in the same message
--   said "only Starting Point." Confirm which one you meant.
--
-- WORKFLOW RULES CONFIRMED THIS ROUND (backend logic, not schema changes):
--   - Applicant = HOS/HOD of their own unit -> skip HOS_HOD_REVIEW,
--     F&B reviews instead (unconditionally).
--   - Applicant = CFO or F&B -> skip ALL higher approval, straight to
--     department_review.
--   - Cafeteria "shared inbox" = a request_task with assignment_mode=
--     'shared_pool' and zero task_assignment rows is visible to every
--     cafeteria_staff assigned (via cafeteria_assignment) to that specific
--     cafeteria. The first one to insert a task_assignment row owns it —
--     it then leaves everyone else's inbox and enters that person's
--     ongoing/history.
-- ============================================================================


-- ============================================================================
-- SECTION 1: IDENTITY & ORGANIZATION
-- ============================================================================

CREATE TABLE users (
    user_id       BIGSERIAL PRIMARY KEY,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    phone_number  VARCHAR(30),
    role          VARCHAR(30) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_users_role CHECK (role IN (
        'student','staff','hos_hod','cfo','fnb',
        'logistics_manager','logistics_staff',
        'transportation_manager','transportation_staff',
        'photo_video_manager','photo_video_staff',
        'sound_light_manager','sound_light_staff',
        'cafeteria_admin','cafeteria_manager','cafeteria_staff',
        'system_admin'
    ))
);

CREATE TABLE staff (
    staff_id               BIGSERIAL PRIMARY KEY,
    user_id                BIGINT NOT NULL UNIQUE REFERENCES users(user_id),
    department_or_school   VARCHAR(150)
);

CREATE TABLE student (
    student_id  BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE REFERENCES users(user_id),
    school      VARCHAR(150)
);

CREATE TABLE unit (
    code          VARCHAR(20) PRIMARY KEY,
    description   VARCHAR(200) NOT NULL,
    head_user_id  BIGINT REFERENCES users(user_id),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE unit_users (
    user_id    BIGINT NOT NULL REFERENCES users(user_id),
    unit_code  VARCHAR(20) NOT NULL REFERENCES unit(code),
    PRIMARY KEY (user_id, unit_code)
);

CREATE TABLE clubs (
    club_id    BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(user_id),
    club_name  VARCHAR(150) NOT NULL
);

CREATE TABLE student_clubs (
    club_id      BIGINT NOT NULL REFERENCES clubs(club_id),
    student_id   BIGINT NOT NULL REFERENCES student(student_id),
    date_joined  DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (club_id, student_id)
);


-- ============================================================================
-- SECTION 2: CAFETERIA DOMAIN
-- ============================================================================

CREATE TABLE cafeteria (
    cafeteria_id  BIGSERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE cafeteria_assignment (
    cafeteria_assignment_id  BIGSERIAL PRIMARY KEY,
    cafeteria_id              BIGINT NOT NULL REFERENCES cafeteria(cafeteria_id),
    user_id                   BIGINT NOT NULL REFERENCES users(user_id),
    assignment_role           VARCHAR(10) NOT NULL CHECK (assignment_role IN ('manager','staff')),
    assigned_by_user_id       BIGINT REFERENCES users(user_id),  -- the Cafeteria Admin who made the call
    assigned_at               TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (cafeteria_id, user_id)
);
-- A cafeteria_manager or cafeteria_staff user can appear in multiple rows
-- (assigned to more than one cafeteria). The "shared inbox" for a given
-- cafeteria's fulfilment tasks is scoped to staff assigned here.


-- ============================================================================
-- SECTION 3: CATEGORIES & REQUIREMENTS
-- ============================================================================

CREATE TABLE event_category (
    event_category_id  BIGSERIAL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL UNIQUE,
    active              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE event_requirements (
    requirement_id    BIGSERIAL PRIMARY KEY,
    requirement_name  VARCHAR(100) NOT NULL UNIQUE
);


-- ============================================================================
-- SECTION 4: MANAGER-CONFIGURED OPTIONS (one table per dropdown "page")
-- ============================================================================
-- Common fields on every option table: label, description, active, plus
-- requirement_id linking it to the relevant event_requirements row.

CREATE TABLE logistics_options (
    logistics_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id        BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                  VARCHAR(150) NOT NULL,
    description             TEXT,
    active                   BOOLEAN NOT NULL DEFAULT TRUE,
    available_quantity        INTEGER NOT NULL CHECK (available_quantity >= 0),
    quantity_unit               VARCHAR(50) NOT NULL,
    item_image_url                 VARCHAR(255)
);

CREATE TABLE transportation_options (
    transportation_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id             BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                       VARCHAR(150) NOT NULL,
    description                  TEXT,
    active                        BOOLEAN NOT NULL DEFAULT TRUE,
    passenger_capacity             INTEGER NOT NULL CHECK (passenger_capacity >= 1),
    available_vehicle_count          INTEGER NOT NULL CHECK (available_vehicle_count >= 0),
    instructions                       TEXT,
    vehicle_image_url                     VARCHAR(255)
);

CREATE TABLE media_options (  -- Photography / Videography
    media_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id     BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                VARCHAR(150) NOT NULL,
    description            TEXT,
    active                   BOOLEAN NOT NULL DEFAULT TRUE,
    max_personnel              INTEGER CHECK (max_personnel >= 1)
);

CREATE TABLE sound_light_options (
    sound_light_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id           BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                     VARCHAR(150) NOT NULL,
    description                 TEXT,
    active                       BOOLEAN NOT NULL DEFAULT TRUE,
    available_quantity            INTEGER NOT NULL CHECK (available_quantity >= 0),
    technical_description           TEXT NOT NULL
);

-- Shared lookup lists used by fnb_options below (editable by Cafeteria
-- Manager and F&B/FMB Manager both — that's a permissions detail, not a
-- schema one; there's just one shared table either way).
CREATE TABLE dietary_information_options (
    dietary_information_option_id  BIGSERIAL PRIMARY KEY,
    label                            VARCHAR(150) NOT NULL,
    description                        TEXT,
    active                               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE serving_unit_options (
    serving_unit_option_id  BIGSERIAL PRIMARY KEY,
    label                     VARCHAR(150) NOT NULL,
    description                 TEXT,
    active                       BOOLEAN NOT NULL DEFAULT TRUE
);

-- "My Menu" — scoped to ONE cafeteria. This is what F&B picks from when
-- fulfilling a food request (see request_fnb_selection further down).
CREATE TABLE fnb_options (
    fnb_option_id                  BIGSERIAL PRIMARY KEY,
    requirement_id                   BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    cafeteria_id                       BIGINT NOT NULL REFERENCES cafeteria(cafeteria_id),
    label                                VARCHAR(150) NOT NULL,
    description                            TEXT,
    active                                   BOOLEAN NOT NULL DEFAULT TRUE,
    serving_unit_option_id                     BIGINT NOT NULL REFERENCES serving_unit_options(serving_unit_option_id),
    dietary_information_option_id                 BIGINT NOT NULL REFERENCES dietary_information_options(dietary_information_option_id),
    availability_ordering_notes                      TEXT,
    menu_image_url                                      VARCHAR(255)
);

-- Campus Tour — 3 separate tables (see the open question in the header).
CREATE TABLE campus_tour_start_options (
    campus_tour_start_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id                 BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                            VARCHAR(150) NOT NULL,
    description                        TEXT,
    active                               BOOLEAN NOT NULL DEFAULT TRUE,
    meeting_instructions                  TEXT,
    max_group_size                          INTEGER CHECK (max_group_size >= 1)
);

CREATE TABLE campus_tour_area_options (
    campus_tour_area_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id                BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                           VARCHAR(150) NOT NULL,
    description                       TEXT,
    active                              BOOLEAN NOT NULL DEFAULT TRUE,
    estimated_duration_minutes           INTEGER CHECK (estimated_duration_minutes >= 1),
    access_restrictions_notes              TEXT
);

CREATE TABLE campus_tour_map_options (
    campus_tour_map_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id                BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                           VARCHAR(150) NOT NULL,
    description                       TEXT,
    active                              BOOLEAN NOT NULL DEFAULT TRUE,
    campus_map_url                       VARCHAR(255) NOT NULL,
    map_route_guidance                     TEXT
);

-- Mineral Water — kept as 2 tables (Logo has an extra field Normal doesn't).
CREATE TABLE water_logo_options (
    water_logo_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id           BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                     VARCHAR(150) NOT NULL,
    description                 TEXT,
    active                       BOOLEAN NOT NULL DEFAULT TRUE,
    number_of_bottles             INTEGER NOT NULL CHECK (number_of_bottles >= 0),
    available_stock                 INTEGER NOT NULL CHECK (available_stock >= 0),
    logo_branding_requirement         TEXT,
    lead_time_ordering_instructions     TEXT
);

CREATE TABLE water_normal_options (
    water_normal_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id             BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                       VARCHAR(150) NOT NULL,
    description                   TEXT,
    active                         BOOLEAN NOT NULL DEFAULT TRUE,
    number_of_bottles               INTEGER NOT NULL CHECK (number_of_bottles >= 0),
    available_stock                   INTEGER NOT NULL CHECK (available_stock >= 0),
    ordering_delivery_instructions      TEXT
);

CREATE TABLE funding_main_options (
    funding_main_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id             BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                       VARCHAR(150) NOT NULL,
    description                   TEXT,
    active                          BOOLEAN NOT NULL DEFAULT TRUE,
    budget_category_finance_code      VARCHAR(50),
    purchasing_guidance                 TEXT
);

CREATE TABLE funding_sub_options (
    funding_sub_option_id   BIGSERIAL PRIMARY KEY,
    main_option_id             BIGINT NOT NULL REFERENCES funding_main_options(funding_main_option_id),
    label                        VARCHAR(150) NOT NULL,
    description                    TEXT,
    active                           BOOLEAN NOT NULL DEFAULT TRUE,
    finance_procurement_code           VARCHAR(50),
    default_unit_purchasing_note         TEXT
);


-- ============================================================================
-- SECTION 5: CONFIG
-- ============================================================================

CREATE TABLE config (
    code    VARCHAR(50) PRIMARY KEY,
    number  NUMERIC NOT NULL
);
-- INSERT INTO config VALUES ('HIGH_PAX_THRESHOLD', 50);
-- INSERT INTO config VALUES ('CANCELLATION_DEADLINE_DAYS', 3);
-- INSERT INTO config VALUES ('MAX_EVENT_CATEGORIES', 2);


-- ============================================================================
-- SECTION 6: REQUEST (core proposal)
-- ============================================================================

CREATE TABLE request (
    request_id                       BIGSERIAL PRIMARY KEY,
    request_code                      VARCHAR(30) NOT NULL UNIQUE,
    applicant_user_id                    BIGINT NOT NULL REFERENCES users(user_id),
    applicant_name                          VARCHAR(150) NOT NULL,   -- snapshot
    applicant_email                            VARCHAR(150) NOT NULL,   -- snapshot
    applicant_department_or_school                VARCHAR(150),            -- snapshot; works for staff dept OR student school
    event_title                                      VARCHAR(200) NOT NULL,
    short_introduction                                  TEXT NOT NULL,
    goals_objectives                                       TEXT NOT NULL,
    expected_benefits                                          TEXT NOT NULL,
    event_visibility                                              VARCHAR(20) NOT NULL,
    event_format                                                     VARCHAR(30),
    registration_approval                                               VARCHAR(20),
    promotion_publicity_method                                             TEXT,
    event_image                                                               VARCHAR(255),
    total_pax                                                                   INTEGER NOT NULL DEFAULT 0,
    max_pax                                                                        INTEGER,  -- organizer-set registration cap; confirm this is what you meant
    status                                                                            VARCHAR(30) NOT NULL DEFAULT 'draft',
    submitted_at        TIMESTAMP,
    cancelled_at         TIMESTAMP,
    cancelled_by_user_id  BIGINT REFERENCES users(user_id),
    created_at              TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_request_status CHECK (status IN (
        'draft','submitted','hos_hod_review','high_pax_review',
        'department_review','resubmission_required',
        'completed_approved','completed_rejected','cancelled'
    ))
);
-- status = 'resubmission_required' only applies during the single-actor
-- sequential stages. During department_review, status STAYS
-- 'department_review' even if one department resubmits — that department's
-- own resubmission lives in its request_task row, not here.

CREATE TABLE request_categories (
    request_id    BIGINT NOT NULL REFERENCES request(request_id),
    category_id   BIGINT NOT NULL REFERENCES event_category(event_category_id),
    PRIMARY KEY (request_id, category_id)
);
-- Max count enforced at the app layer, reading config.MAX_EVENT_CATEGORIES.

CREATE TABLE application_requirements (
    request_id      BIGINT NOT NULL REFERENCES request(request_id),
    requirement_id  BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    PRIMARY KEY (request_id, requirement_id)
);


-- ============================================================================
-- SECTION 7: REQUEST-SPECIFIC DEPARTMENT DATA (snapshots)
-- ============================================================================

CREATE TABLE request_logistics (
    request_logistics_id  BIGSERIAL PRIMARY KEY,
    request_id               BIGINT NOT NULL REFERENCES request(request_id),
    option_id                    BIGINT REFERENCES logistics_options(logistics_option_id),
    item                             VARCHAR(150) NOT NULL,
    quantity                             INTEGER NOT NULL,
    date                                     DATE NOT NULL,
    start_time                                  TIME NOT NULL,
    end_time                                        TIME NOT NULL,
    location                                            VARCHAR(200) NOT NULL,
    notes                                                  TEXT
);

CREATE TABLE request_transportation (
    request_transportation_id  BIGSERIAL PRIMARY KEY,
    request_id                     BIGINT NOT NULL REFERENCES request(request_id),
    option_id                          BIGINT REFERENCES transportation_options(transportation_option_id),
    type                                    VARCHAR(150) NOT NULL,
    requested_pax                              INTEGER NOT NULL,
    pickup                                          VARCHAR(200) NOT NULL,
    dropoff                                             VARCHAR(200) NOT NULL,
    date                                                    DATE NOT NULL,
    start_time                                                  TIME NOT NULL,
    end_time                                                        TIME NOT NULL,
    location                                                            VARCHAR(200) NOT NULL,
    notes                                                                  TEXT
);

CREATE TABLE request_photography_videography (
    request_photography_videography_id  BIGSERIAL PRIMARY KEY,
    request_id                               BIGINT NOT NULL REFERENCES request(request_id),
    option_id                                    BIGINT REFERENCES media_options(media_option_id),
    service                                          VARCHAR(150) NOT NULL,
    personnel_quantity                                   INTEGER NOT NULL,
    date                                                      DATE NOT NULL,
    start_time                                                    TIME NOT NULL,
    end_time                                                          TIME NOT NULL,
    location                                                              VARCHAR(200) NOT NULL,
    coverage                                                                  VARCHAR(200) NOT NULL,
    notes                                                                        TEXT
);

CREATE TABLE request_sound_light (
    request_sound_light_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    option_id                       BIGINT REFERENCES sound_light_options(sound_light_option_id),
    item                                 VARCHAR(150) NOT NULL,
    date                                     DATE NOT NULL,
    start_time                                  TIME NOT NULL,
    end_time                                        TIME NOT NULL,
    location                                            VARCHAR(200) NOT NULL,
    notes                                                  TEXT
);

-- The applicant's original food ask.
CREATE TABLE request_fnb (
    request_fnb_id  BIGSERIAL PRIMARY KEY,
    request_id          BIGINT NOT NULL REFERENCES request(request_id),
    option_id                BIGINT REFERENCES fnb_options(fnb_option_id),
    food_type                    VARCHAR(150) NOT NULL,
    pax                              INTEGER NOT NULL,   -- renamed from quantity: "how many people", not units of food
    date                                 DATE NOT NULL,
    start_time                               TIME NOT NULL,
    end_time                                     TIME NOT NULL,
    location                                         VARCHAR(200) NOT NULL,
    notes                                                 TEXT
);

-- F&B's actual fulfilment action: picks a cafeteria + a real menu item.
CREATE TABLE request_fnb_selection (
    request_fnb_selection_id  BIGSERIAL PRIMARY KEY,
    request_fnb_id                BIGINT NOT NULL REFERENCES request_fnb(request_fnb_id),
    cafeteria_id                      BIGINT NOT NULL REFERENCES cafeteria(cafeteria_id),
    fnb_option_id                         BIGINT NOT NULL REFERENCES fnb_options(fnb_option_id),
    menu_item_label                           VARCHAR(150) NOT NULL,  -- snapshot of fnb_options.label at pick time
    quantity                                       INTEGER NOT NULL,
    notes                                                TEXT
);

CREATE TABLE request_campus_tour (
    request_campus_tour_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    date                             DATE NOT NULL,
    start_time                           TIME NOT NULL,
    end_time                                 TIME NOT NULL,
    location                                     VARCHAR(200) NOT NULL,
    pax                                              INTEGER NOT NULL,
    start_point_option_id                                BIGINT REFERENCES campus_tour_start_options(campus_tour_start_option_id),
    start_point                                              VARCHAR(150) NOT NULL,
    tour_area_option_id                                          BIGINT REFERENCES campus_tour_area_options(campus_tour_area_option_id),
    tour_area                                                        VARCHAR(150),   -- nullable: drop if you trim to Starting-Point-only
    campus_map_option_id                                                 BIGINT REFERENCES campus_tour_map_options(campus_tour_map_option_id),
    campus_map                                                               VARCHAR(150),   -- nullable, same reason
    notes                                                                        TEXT
);

CREATE TABLE request_mineral_water_logo (
    request_mineral_water_logo_id  BIGSERIAL PRIMARY KEY,
    request_id                         BIGINT NOT NULL REFERENCES request(request_id),
    option_id                              BIGINT REFERENCES water_logo_options(water_logo_option_id),
    quantity                                   INTEGER NOT NULL,
    date                                           DATE NOT NULL,
    start_time                                         TIME NOT NULL,
    end_time                                               TIME NOT NULL,
    location                                                   VARCHAR(200) NOT NULL,
    notes                                                          TEXT
);

CREATE TABLE request_mineral_water_normal (
    request_mineral_water_normal_id  BIGSERIAL PRIMARY KEY,
    request_id                           BIGINT NOT NULL REFERENCES request(request_id),
    option_id                                BIGINT REFERENCES water_normal_options(water_normal_option_id),
    quantity                                     INTEGER NOT NULL,
    date                                             DATE NOT NULL,
    start_time                                           TIME NOT NULL,
    end_time                                                 TIME NOT NULL,
    location                                                     VARCHAR(200) NOT NULL,
    notes                                                            TEXT
);

CREATE TABLE request_funding_purchase (
    request_funding_purchase_id  BIGSERIAL PRIMARY KEY,
    request_id                       BIGINT NOT NULL REFERENCES request(request_id),
    main_option_id                       BIGINT REFERENCES funding_main_options(funding_main_option_id),
    main_item                                VARCHAR(150) NOT NULL,
    sub_option_id                                BIGINT REFERENCES funding_sub_options(funding_sub_option_id),
    sub_item                                         VARCHAR(150) NOT NULL,
    quantity                                             INTEGER NOT NULL,
    unit_price_rm                                            NUMERIC(10,2) NOT NULL,
    notes                                                         TEXT
);


-- ============================================================================
-- SECTION 8: REQUEST SUPPORT TABLES
-- ============================================================================

CREATE TABLE co_owners (
    co_owner_id       BIGSERIAL PRIMARY KEY,
    request_id            BIGINT NOT NULL REFERENCES request(request_id),
    staff_id                  BIGINT REFERENCES staff(staff_id),
    staff_first_name              VARCHAR(100) NOT NULL,
    staff_last_name                   VARCHAR(100) NOT NULL,
    staff_email                           VARCHAR(150) NOT NULL,
    staff_role                                VARCHAR(100)
);

CREATE TABLE organizers (
    organizer_id      BIGSERIAL PRIMARY KEY,
    request_id             BIGINT NOT NULL REFERENCES request(request_id),
    staff_id                   BIGINT REFERENCES staff(staff_id),
    staff_first_name               VARCHAR(100) NOT NULL,
    staff_last_name                    VARCHAR(100) NOT NULL,
    staff_email                            VARCHAR(150) NOT NULL,
    staff_role                                 VARCHAR(100),
    note                                            TEXT
);

CREATE TABLE important_people (
    important_person_id  BIGSERIAL PRIMARY KEY,
    request_id                BIGINT NOT NULL REFERENCES request(request_id),
    name                           VARCHAR(150) NOT NULL,
    type                               VARCHAR(30) NOT NULL,
    organization                          VARCHAR(150),
    designation                               VARCHAR(150),
    CONSTRAINT chk_important_people_type CHECK (
        type IN ('VIP','Speaker','Partner','Important Guest')
    )
);

CREATE TABLE general_guest (
    general_guest_id  BIGSERIAL PRIMARY KEY,
    request_id             BIGINT NOT NULL REFERENCES request(request_id),
    guest_type                 VARCHAR(30) NOT NULL,
    count                           INTEGER NOT NULL CHECK (count >= 0),
    notes                               TEXT,
    CONSTRAINT chk_general_guest_type CHECK (
        guest_type IN ('Students','APU Staff','External Guests',
                        'Parents-Guardians','Industry Partners','Alumni','Others')
    )
);

CREATE TABLE event_schedule (
    event_schedule_id  BIGSERIAL PRIMARY KEY,
    request_id              BIGINT NOT NULL REFERENCES request(request_id),
    date                        DATE NOT NULL,
    start_time                      TIME NOT NULL,
    end_time                            TIME NOT NULL,
    location                                VARCHAR(200) NOT NULL
);

CREATE TABLE brief_agenda (
    brief_agenda_id  BIGSERIAL PRIMARY KEY,
    request_id            BIGINT NOT NULL REFERENCES request(request_id),
    time                      TIME NOT NULL,
    activity                      VARCHAR(200) NOT NULL,
    location                          VARCHAR(200) NOT NULL,
    pic                                   VARCHAR(150) NOT NULL,
    notes                                     TEXT
);

CREATE TABLE request_discussion_topics (
    request_discussion_topic_id  BIGSERIAL PRIMARY KEY,
    request_id                        BIGINT NOT NULL REFERENCES request(request_id),
    discussion_topic                      VARCHAR(200) NOT NULL
);


-- ============================================================================
-- SECTION 9: EVENT DISCOVERY / REGISTRATION
-- ============================================================================

CREATE TABLE event_registration (
    event_registration_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    user_id                         BIGINT NOT NULL REFERENCES users(user_id),
    registrant_name                     VARCHAR(150) NOT NULL,   -- snapshot
    registrant_email                        VARCHAR(150) NOT NULL,   -- snapshot
    reason_for_attending                        VARCHAR(100),   -- collected only when registration_approval = 'manual'
    status                                          VARCHAR(20) NOT NULL DEFAULT 'registered',
    registered_at                                       TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_registration_status CHECK (
        status IN ('registered','pending_approval','rejected','cancelled')
    )
);
-- Partial unique index instead of a blanket UNIQUE constraint, so someone
-- can cancel and later re-register for the same event:
CREATE UNIQUE INDEX uq_event_registration_active
    ON event_registration (request_id, user_id)
    WHERE status <> 'cancelled';
-- Pending/manual approvals surface in the applicant's inbox by querying
-- event_registration WHERE request_id IN (their requests) AND
-- status='pending_approval' — no separate request_task row needed, this is
-- a much simpler single-approver flow than the request approval chain.

CREATE TABLE saved_event (
    user_id     BIGINT NOT NULL REFERENCES users(user_id),
    request_id  BIGINT NOT NULL REFERENCES request(request_id),
    saved_at    TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_id)
);


-- ============================================================================
-- SECTION 10: WORKFLOW — TASKS, ASSIGNMENTS, HISTORY
-- ============================================================================
-- Inbox / Ongoing / History are still queries, not tables — see the earlier
-- audit file for the exact query shape. Unchanged from the previous version
-- except for the renamed PK.

CREATE TABLE request_task (
    request_task_id     BIGSERIAL PRIMARY KEY,
    request_id               BIGINT NOT NULL REFERENCES request(request_id),
    requirement_id                BIGINT REFERENCES event_requirements(requirement_id),
    stage_code                        VARCHAR(40) NOT NULL,
    sequence_no                           SMALLINT NOT NULL DEFAULT 1,
    assigned_role                             VARCHAR(30) NOT NULL,
    assignment_mode                               VARCHAR(15) NOT NULL DEFAULT 'assigned',
    status                                            VARCHAR(20) NOT NULL DEFAULT 'pending',
    comment                                               TEXT,
    created_at                                                TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at                                                  TIMESTAMP,
    resolved_by_user_id                                              BIGINT REFERENCES users(user_id),
    CONSTRAINT chk_task_assignment_mode CHECK (assignment_mode IN ('assigned','shared_pool')),
    CONSTRAINT chk_task_status CHECK (
        status IN ('pending','approved','resubmitted','rejected','completed','cancelled')
    )
);

CREATE TABLE task_assignment (
    task_assignment_id   BIGSERIAL PRIMARY KEY,
    request_task_id          BIGINT NOT NULL REFERENCES request_task(request_task_id),
    staff_user_id                 BIGINT NOT NULL REFERENCES users(user_id),
    assigned_by_user_id               BIGINT REFERENCES users(user_id),  -- NULL = self-claimed (shared_pool)
    assigned_at                           TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (request_task_id, staff_user_id)
);

CREATE TABLE workflow_history (
    workflow_history_id  BIGSERIAL PRIMARY KEY,
    request_id                 BIGINT NOT NULL REFERENCES request(request_id),
    request_task_id                 BIGINT REFERENCES request_task(request_task_id),
    requirement_id                       BIGINT REFERENCES event_requirements(requirement_id),
    action                                    VARCHAR(30) NOT NULL,
    actor_user_id                                BIGINT NOT NULL REFERENCES users(user_id),
    actor_role                                       VARCHAR(30) NOT NULL,
    comment                                              TEXT,
    previous_status                                          VARCHAR(30),
    new_status                                                   VARCHAR(30),
    created_at                                                       TIMESTAMP NOT NULL DEFAULT now()
);
