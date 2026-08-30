"""Seed data definitions - system data only, no proposals or submissions.

Everything here is reference data an administrator would otherwise have to
enter by hand before the system is usable: the org chart, the role catalogue,
the sidebar and its permission grants, the dropdown option catalogues, and
enough demo accounts to exercise every path through the workflow.

Deliberately absent: `request` rows and anything hanging off them. Proposals are
created through the API so they go through the real state machine.
"""
from __future__ import annotations

# --- Roles ----------------------------------------------------------------
# is_protected: role_name/description stay editable, but the role can never be
# deleted and its unit links can never change via the API.
PROTECTED_ROLES = [
    ("head-of-school", "Head of School", "Heads a School unit; reviews proposals from that School (HOS/HOD stage)."),
    ("head-of-department", "Head of Department", "Heads a Service department unit; reviews proposals routed to that department."),
    ("lecturer", "Lecturer", "Academic staff member of a School."),
    ("staff", "Staff", "General staff member of any unit (School or Service department)."),
    ("student", "Student", "Student enrolled under a School."),
    ("cfo", "CFO", "Finance Office - reviews high-pax proposals at the CFO stage."),
    ("cafeteria-admin", "Cafeteria Admin", "Creates cafeterias and assigns managers/staff to them."),
    ("cafeteria-manager", "Cafeteria Manager", "Manages one or more specific cafeterias: menu, staff, day-to-day operations."),
    ("cafeteria-staff", "Cafeteria Staff", "Works at a cafeteria assigned by a Cafeteria Admin."),
    ("external-user", "External User", "Self-registered guest account from outside the university. Never assignable by an admin."),
    ("system-admin", "System Admin", "Manages users, units, roles, and page visibility."),
    ("club-admin", "Club Admin", "Creates, deletes, and deactivates clubs; manages club categories. System-wide, not tied to a specific club."),
]

# --- Units ----------------------------------------------------------------
# Schools carry a head-of-school; Service departments carry a head-of-department.
SCHOOL_UNITS = [
    ("school_of_computing", "School of Computing"),
    ("school_of_business", "School of Business"),
]
SERVICE_UNITS = [
    ("logistics_and_facilities", "Logistics and Facilities"),
    ("transport_services", "Transport Services"),
    ("photography_services", "Photography Services"),
    ("a_v_services", "A/V Services"),
    ("student_services", "Student Services"),
    ("food_beverage_services", "F&B"),
]
CAFETERIA_UNIT_PREFIX = "cafeteria__"
CAFETERIA_UNITS = [
    (CAFETERIA_UNIT_PREFIX + "atrium_cafeteria", "Atrium Cafeteria"),
    (CAFETERIA_UNIT_PREFIX + "level_3_food_court", "Level 3 Food Court"),
]

# --- Demo accounts --------------------------------------------------------
# (email, display name, [(role_code, unit_code | None), ...]) One account per distinct position in the
# workflow, so every stage and every department lane can be exercised end to end.
SEED_ACCOUNTS = [
    ("applicant@demo.apu.edu.my", "Applicant Demo", [("student", "school_of_computing")]),
    ("hoshod@demo.apu.edu.my", "Rahim Abdullah", [("head-of-school", "school_of_computing")]),
    ("cfo@demo.apu.edu.my", "Cheryl Foong", [("cfo", None)]),
    ("fmb@demo.apu.edu.my", "Nadia Hashim", [("head-of-department", "food_beverage_services")]),
    ("fmb.staff@demo.apu.edu.my", "Iqbal Yusof", [("staff", "food_beverage_services")]),

    ("cafeteria.admin@demo.apu.edu.my", "Cafeteria Admin", [("cafeteria-admin", None)]),
    ("cafeteria.manager@demo.apu.edu.my", "Siti Aminah", [("cafeteria-manager", CAFETERIA_UNITS[0][0])]),
    ("cafeteria.manager2@demo.apu.edu.my", "Lim Wei Sheng", [("cafeteria-manager", CAFETERIA_UNITS[1][0])]),
    ("cafeteria.staff@demo.apu.edu.my", "Faridah Omar", [("cafeteria-staff", CAFETERIA_UNITS[0][0])]),
    ("cafeteria.staff2@demo.apu.edu.my", "Ravi Chandran", [("cafeteria-staff", CAFETERIA_UNITS[0][0])]),
    ("cafeteria.staff3@demo.apu.edu.my", "Tan Mei Yee", [("cafeteria-staff", CAFETERIA_UNITS[1][0])]),

    ("logistics.manager@demo.apu.edu.my", "Zulkifli Hamzah", [("head-of-department", "logistics_and_facilities")]),
    ("logistics.staff@demo.apu.edu.my", "Ahmad Firdaus", [("staff", "logistics_and_facilities")]),
    ("logistics.staff2@demo.apu.edu.my", "David Tan", [("staff", "logistics_and_facilities")]),
    ("logistics.staff3@demo.apu.edu.my", "Sarah Lee", [("staff", "logistics_and_facilities")]),

    ("student.services.manager@demo.apu.edu.my", "Kamala Devi", [("head-of-department", "student_services")]),
    ("student.services.member@demo.apu.edu.my", "Priyah Raman", [("staff", "student_services")]),
    ("student.services.member2@demo.apu.edu.my", "Jason Lim", [("staff", "student_services")]),
    ("student.services.member3@demo.apu.edu.my", "Chloe Tan", [("staff", "student_services")]),

    ("av.manager@demo.apu.edu.my", "Gopal Menon", [("head-of-department", "a_v_services")]),
    ("av.technician@demo.apu.edu.my", "Marcus Vance", [("staff", "a_v_services")]),
    ("av.technician2@demo.apu.edu.my", "Ethan Wong", [("staff", "a_v_services")]),
    ("av.technician3@demo.apu.edu.my", "Nurul Huda", [("staff", "a_v_services")]),

    ("photography.manager@demo.apu.edu.my", "Lina Marzuki", [("head-of-department", "photography_services")]),
    ("photographer@demo.apu.edu.my", "Alex Rivera", [("staff", "photography_services")]),
    ("photographer2@demo.apu.edu.my", "Samantha Ong", [("staff", "photography_services")]),

    ("transport.manager@demo.apu.edu.my", "Hafiz Roslan", [("head-of-department", "transport_services")]),
    ("transport.staff@demo.apu.edu.my", "Bob Sinnappan", [("staff", "transport_services")]),
    ("transport.staff2@demo.apu.edu.my", "Harish Kumar", [("staff", "transport_services")]),

    ("system.admin@demo.apu.edu.my", "System Admin", [("system-admin", None)]),
    ("club.admin@demo.apu.edu.my", "Jordan Lee", [("club-admin", None)]),

    ("hos.business@demo.apu.edu.my", "Farah Aziz", [("head-of-school", "school_of_business")]),
    ("lecturer.computing@demo.apu.edu.my", "Kumar Selvam", [("lecturer", "school_of_computing")]),
    ("lecturer.business@demo.apu.edu.my", "Siti Nurhaliza", [("lecturer", "school_of_business")]),
    ("student.computing@demo.apu.edu.my", "Aina Rahman", [("student", "school_of_computing")]),
    ("student.computing2@demo.apu.edu.my", "Mei Ling Tan", [("student", "school_of_computing")]),
    ("student.business@demo.apu.edu.my", "Daniel Wong", [("student", "school_of_business")]),
    # Deliberately role-less: an account that exists but has not been onboarded.
    # Exercises the "user with no assignment" path in the directory and login.
    ("farah.izzati@staff.apu.edu.my", "Farah Izzati", []),
]

# --- Catalogues -----------------------------------------------------------
EVENT_CATEGORIES = [
    "Academic & Career",
    "Workshops & Training",
    "Sports & Wellness",
    "Culture & Community",
    "Clubs & Societies",
    "Entertainment & Social",
    "Volunteering",
]
EVENT_FORMATS = ["On Campus", "Online", "Hybrid", "Off Campus"]

# requirement_name values are the routing keys in workflow/constants.py.
EVENT_REQUIREMENTS = [
    "logistics",
    "transportation",
    "photoVideo",
    "soundLight",
    "fmb",
    "campusTour",
    "waterNormal",
    "fundingPurchase",
]

CONFIG_VALUES = [
    ("HIGH_PAX_THRESHOLD", 50),
    ("CANCELLATION_DEADLINE_DAYS", 3),
    ("MAX_EVENT_CATEGORIES", 2),
    ("MIN_EVENT_LEAD_DAYS", 0),
]

# --- Dropdown option catalogues ------------------------------------------
# (table, requirement_name, [(label, description, extra_columns), ...])
LOGISTICS_OPTIONS = [
    ("Round Table (8 pax)", "Standard banquet round table.", {"available_quantity": 40, "quantity_unit": "table"}),
    ("Rectangular Table", "Registration or exhibition table.", {"available_quantity": 30, "quantity_unit": "table"}),
    ("Banquet Chair", "Padded stacking chair.", {"available_quantity": 400, "quantity_unit": "chair"}),
    ("Portable Stage Deck", "1m x 2m modular stage section.", {"available_quantity": 12, "quantity_unit": "deck"}),
    ("Pull-up Banner Stand", "Free-standing banner frame.", {"available_quantity": 20, "quantity_unit": "stand"}),
    ("Canopy Tent (3m x 3m)", "Outdoor shelter.", {"available_quantity": 8, "quantity_unit": "tent"}),
]
TRANSPORTATION_OPTIONS = [
    ("40-Seater Coach", "Full-size chartered coach.", {"passenger_capacity": 40, "available_vehicle_count": 3}),
    ("18-Seater Van", "Mini coach for small groups.", {"passenger_capacity": 18, "available_vehicle_count": 4}),
    ("7-Seater MPV", "For VIP or small-team transfers.", {"passenger_capacity": 7, "available_vehicle_count": 2}),
    ("Cargo Van", "Equipment transport, no passengers.", {"passenger_capacity": 2, "available_vehicle_count": 2}),
]
MEDIA_OPTIONS = [
    ("Event Photography", "Roaming photographer for the duration of the event.", {}),
    ("Event Videography", "Video coverage with edited highlight reel.", {}),
    ("Livestream Coverage", "Multi-camera livestream to a nominated channel.", {}),
    ("Photo Booth", "Staffed booth with instant prints.", {}),
]
SOUND_LIGHT_OPTIONS = [
    ("Basic PA System", "Two speakers, mixer, one wired microphone.", {"technical_description": "2x 12in powered speakers, 4-channel mixer, 1x wired SM58."}),
    ("Full Stage Sound", "Line array, monitors, and a sound engineer.", {"technical_description": "Line array PA, 4x stage monitors, 24-channel digital desk, 1 engineer."}),
    ("Wireless Microphone", "Handheld or lapel, per unit.", {"technical_description": "UHF wireless, handheld or lavalier capsule, 8h battery."}),
    ("Stage Lighting Rig", "Front wash plus four moving heads.", {"technical_description": "6x LED PAR front wash, 4x moving head, DMX desk."}),
    ("LED Wall (3m x 2m)", "Indoor LED display with a media server.", {"technical_description": "P3.9 indoor panels, 3m x 2m, media server and operator."}),
]
# No requirement_id column on these two - they are shared lookups, not per-requirement.
DIETARY_OPTIONS = [
    ("Halal", "Certified halal preparation.", {}),
    ("Vegetarian", "No meat or fish.", {}),
    ("Vegan", "No animal products at all.", {}),
    ("Nut-free", "Prepared without nuts or nut derivatives.", {}),
    ("Gluten-free", "Prepared without gluten-containing grains.", {}),
]
SERVING_UNIT_OPTIONS = [
    ("Per Person", "Priced and counted per attendee.", {}),
    ("Per Tray", "Serves roughly 10 people.", {}),
    ("Per Box", "Individually packed set.", {}),
    ("Per Litre", "For beverages served in bulk.", {}),
]
CAMPUS_TOUR_START_OPTIONS = [
    ("Main Lobby", "Ground floor, New Campus block.", {}),
    ("Library Entrance", "Level 3 walkway.", {}),
    ("Auditorium Foyer", "Beside the main auditorium.", {}),
]
CAMPUS_TOUR_TYPE_OPTIONS = [
    ("General Campus Tour", "Standard 45-minute walkthrough.", {}),
    ("Facilities Tour", "Labs, studios, and workshops.", {}),
    ("Accommodation Tour", "Student residence walkthrough.", {}),
]
# University venues - the single source for every Inside University dropdown in
# the system. Managed by the CFO at /app/dropdown-options/venue after seeding;
# this is only the starting list. (label, description, {extra columns})
VENUE_OPTIONS = [
    ("Auditorium", "Main auditorium, tiered seating.", {"capacity": 500}),
    ("Grand Hall", "Largest flat-floor hall, full staging supported.", {"capacity": 800}),
    ("Main Hall", "Flat-floor hall for fairs and exhibitions.", {"capacity": 600}),
    ("Level 6 Multipurpose Hall", "Divisible hall on level 6.", {"capacity": 250}),
    ("Seminar Room 1", "Seminar room, boardroom or theatre layout.", {"capacity": 60}),
    ("Seminar Room 2", "Seminar room, boardroom or theatre layout.", {"capacity": 60}),
    ("Lecture Theatre 3", "Tiered lecture theatre.", {"capacity": 180}),
    ("Lecture Theatre 5", "Tiered lecture theatre.", {"capacity": 180}),
    ("Innovation Lab", "Project space with workbenches and power.", {"capacity": 40}),
    ("Campus Green", "Outdoor lawn, weather dependent.", {"capacity": 1000}),
    ("Basketball Court", "Outdoor court, also used for large gatherings.", {"capacity": 400}),
    ("Library Discussion Zone", "Group study area on the library floor.", {"capacity": 30}),
    ("Atrium Concourse", "Central concourse, high footfall.", {"capacity": 350}),
    ("Block D Studio", "Studio space with lighting rig.", {"capacity": 80}),
    ("Sports Complex", "Indoor sports hall.", {"capacity": 900}),
    ("Boardroom A", "Executive boardroom, seats 20.", {"capacity": 20}),
]

FUNDING_MAIN_OPTIONS = [
    ("Venue & Facilities", "Room hire, setup, and cleaning.", "FIN-VEN"),
    ("Food & Beverage", "Catering and refreshments.", "FIN-FNB"),
    ("Marketing & Publicity", "Design, print, and promotion.", "FIN-MKT"),
    ("Speaker & Talent", "Honoraria and travel.", "FIN-SPK"),
    ("Equipment Rental", "Third-party equipment hire.", "FIN-EQP"),
]
# (main option label, [(sub label, description), ...])
FUNDING_SUB_OPTIONS = [
    ("Venue & Facilities", [("External Venue Hire", "Off-campus space rental."), ("Cleaning Services", "Post-event cleaning crew.")]),
    ("Food & Beverage", [("Catering Packages", "Per-head catering."), ("Refreshment Breaks", "Tea break service.")]),
    ("Marketing & Publicity", [("Printed Collateral", "Posters, flyers, banners."), ("Paid Social Media", "Sponsored posts.")]),
    ("Speaker & Talent", [("Speaker Honorarium", "Fee paid to an external speaker."), ("Travel & Accommodation", "Speaker travel costs.")]),
    ("Equipment Rental", [("AV Equipment Hire", "Third-party AV rental."), ("Furniture Hire", "Additional furniture.")]),
]
# Menu items per cafeteria unit code. (label, description, serving unit, dietary tag, unit price in
# RM).
FMB_MENU = {
    CAFETERIA_UNITS[0][0]: [
        ("Nasi Lemak Set", "Coconut rice, sambal, egg, anchovies.", "Per Person", "Halal", 8.50),
        ("Mee Goreng Mamak", "Spiced fried noodles.", "Per Person", "Vegetarian", 7.00),
        ("Chicken Rice Box", "Steamed chicken with rice and soup.", "Per Box", "Halal", 9.50),
        ("Assorted Kuih Tray", "Traditional cakes, 20 pieces.", "Per Tray", "Vegetarian", 45.00),
        ("Teh Tarik Urn", "Pulled milk tea, served hot.", "Per Litre", "Halal", 30.00),
    ],
    CAFETERIA_UNITS[1][0]: [
        ("Sandwich Platter", "Assorted sandwiches, 10 rounds.", "Per Tray", "Vegetarian", 55.00),
        ("Pasta Aglio Olio", "Garlic and chilli pasta.", "Per Person", "Vegan", 10.00),
        ("Fruit Platter", "Seasonal cut fruit.", "Per Tray", "Vegan", 40.00),
        ("Curry Puff Box", "Twelve pieces per box.", "Per Box", "Halal", 24.00),
        ("Fresh Orange Juice", "Cold-pressed, no added sugar.", "Per Litre", "Vegan", 18.00),
    ],
}

CLUB_CATEGORIES = [
    "Academic",
    "Sports",
    "Arts & Culture",
    "Technology",
    "Community Service",
    "Special Interest",
]
# (club name, description, president email, [category names])
CLUBS = [
    ("APU Coding Society", "Weekly hackathons, workshops, and competitive programming.", "student.computing@demo.apu.edu.my", ["Technology", "Academic"]),
    ("Business Leaders Circle", "Case competitions, networking, and speaker sessions.", "student.business@demo.apu.edu.my", ["Academic"]),
    ("APU Photography Club", "Photowalks, critique nights, and exhibitions.", "student.computing2@demo.apu.edu.my", ["Arts & Culture", "Special Interest"]),
]
