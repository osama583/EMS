"""Content catalogue for the production-like seed: people, clubs, and events.

Separated from the engine (seed_production.py) for the same reason seed/data.py
is separated from seed/run.py — what the university looks like is data, how it
gets driven through the workflow is code.

Nothing here invents a schema value. Category ids, requirement names, visibility
values and role codes all come from what seed/data.py already established and
migrations 001-028 already constrain.
"""
from __future__ import annotations

# --- Org chart additions ---------------------------------------------------
# Two more Schools, so the portfolio has units with very different volumes:
# Computing is busy, Business is moderate, Engineering is quiet and Media is
# brand new. Adding these means the nav grants that name every unit have to
# learn about them too - see seed_production.extend_nav_grants().
NEW_SCHOOL_UNITS = [
    ("school_of_engineering", "School of Engineering"),
    ("school_of_media_arts", "School of Media and Communication"),
]

# (email, full name, [(role_code, unit_code)])
NEW_FACULTY = [
    ("hos.engineering@demo.apu.edu.my", "Ir. Zainal Karim", [("head-of-school", "school_of_engineering")]),
    ("hos.media@demo.apu.edu.my", "Grace Chandran", [("head-of-school", "school_of_media_arts")]),
    ("lecturer.computing2@demo.apu.edu.my", "Wong Kah Meng", [("lecturer", "school_of_computing")]),
    ("lecturer.computing3@demo.apu.edu.my", "Anusha Pillai", [("lecturer", "school_of_computing")]),
    ("lecturer.business2@demo.apu.edu.my", "Haziq Ismail", [("lecturer", "school_of_business")]),
    ("lecturer.engineering@demo.apu.edu.my", "Tan Chee Keong", [("lecturer", "school_of_engineering")]),
    ("lecturer.engineering2@demo.apu.edu.my", "Noraini Salleh", [("lecturer", "school_of_engineering")]),
    ("lecturer.media@demo.apu.edu.my", "Rachel Yeoh", [("lecturer", "school_of_media_arts")]),
]

# Extra department staff so no lane is staffed by a single person and workloads
# can be spread without anyone holding an impossible number of live rows.
NEW_DEPARTMENT_STAFF = [
    ("logistics.staff4@demo.apu.edu.my", "Nazrin Yaacob", [("staff", "logistics_and_facilities")]),
    ("logistics.staff5@demo.apu.edu.my", "Vimala Krishnan", [("staff", "logistics_and_facilities")]),
    ("photographer3@demo.apu.edu.my", "Jia Hui Loke", [("staff", "photography_services")]),
    ("photographer4@demo.apu.edu.my", "Idris Kamaruddin", [("staff", "photography_services")]),
    ("transport.staff3@demo.apu.edu.my", "Sanjay Menon", [("staff", "transport_services")]),
    ("transport.staff4@demo.apu.edu.my", "Rosli Bakar", [("staff", "transport_services")]),
    ("av.technician4@demo.apu.edu.my", "Clarence Foo", [("staff", "a_v_services")]),
    ("student.services.member4@demo.apu.edu.my", "Hafizah Nordin", [("staff", "student_services")]),
    ("student.services.member5@demo.apu.edu.my", "Ryan D'Cruz", [("staff", "student_services")]),
    ("fmb.staff2@demo.apu.edu.my", "Suraya Halim", [("staff", "food_beverage_services")]),
    ("cafeteria.staff4@demo.apu.edu.my", "Kelvin Yap", [("cafeteria-staff", "cafeteria__atrium_cafeteria")]),
    ("cafeteria.staff5@demo.apu.edu.my", "Norhayati Zain", [("cafeteria-staff", "cafeteria__level_3_food_court")]),
]

# --- Student body ----------------------------------------------------------
# Built combinatorially rather than listed one by one: 100+ hand-typed names add
# nothing a seeded shuffle of a realistic name pool does not, and the pool is
# easier to keep representative of an APU cohort.
GIVEN_NAMES = [
    "Aisyah", "Amirul", "Nur Hidayah", "Muhammad Danial", "Farhan", "Syafiqah",
    "Izzat", "Nabila", "Haikal", "Alia", "Zulhilmi", "Damia", "Aqil", "Batrisyia",
    "Wei Jie", "Xin Yi", "Jia Wen", "Kai Xuan", "Yong Hao", "Mei Xin", "Zhi Hao",
    "Hui Ying", "Jun Kit", "Shu Ting", "Cheng Hong", "Li Wen",
    "Arvind", "Divya", "Karthik", "Meena", "Suresh", "Nithya", "Rajesh", "Kavitha",
    "Prakash", "Shalini",
    "Daniel", "Rebecca", "Joshua", "Chloe", "Nathaniel", "Elaine", "Marcus", "Vanessa",
    "Adrian", "Natalie", "Jonathan", "Melissa",
    "Ahmed", "Fatima", "Omar", "Layla", "Yusuf", "Zahra", "Bilal", "Aaliyah",
    "Chidi", "Ngozi", "Thabo", "Amara", "Nguyen Minh", "Tran Anh",
]
FAMILY_NAMES = [
    "binti Abdullah", "bin Rahman", "binti Ismail", "bin Hashim", "binti Yusof",
    "bin Kamal", "binti Zainal", "bin Mokhtar",
    "Tan", "Lim", "Wong", "Ng", "Chan", "Goh", "Teoh", "Cheah", "Yeoh", "Low",
    "a/l Ramasamy", "a/p Muniandy", "a/l Subramaniam", "a/p Krishnan", "a/l Nair",
    "Fernandez", "D'Souza", "Pereira", "Anderson", "Whitfield", "Okonkwo",
    "Mensah", "Al-Farsi", "Rahimi", "Pham", "Nguyen",
]

# How many students each School gets. Deliberately lopsided: Computing dominates,
# Media has barely opened.
STUDENTS_PER_SCHOOL = {
    "school_of_computing": 46,
    "school_of_business": 30,
    "school_of_engineering": 22,
    "school_of_media_arts": 10,
}

# Self-registered guests who turn up on Public events only.
EXTERNAL_GUESTS = [
    ("priya.menon@outlook.com", "Priya Menon", 27, "Female"),
    ("hakim.rashid@gmail.com", "Hakim Rashid", 34, "Male"),
    ("j.tanaka@example.com", "Junko Tanaka", 29, "Female"),
    ("m.oliveira@example.com", "Mateus Oliveira", 41, "Male"),
    ("s.abdulaziz@example.com", "Sara Abdulaziz", 23, "Female"),
    ("kelvin.chong@example.com", "Kelvin Chong", 38, "Male"),
    ("nadia.ibrahim@example.com", "Nadia Ibrahim", 31, "Female"),
    ("tom.whitfield@example.com", "Tom Whitfield", 45, "Male"),
]

# --- Clubs -----------------------------------------------------------------
# (club name, description, [category names], member count, activity tier)
# activity tier drives how many proposals the club runs: 'high' clubs are the
# ones every screen is full of, 'none' clubs exist and recruit but have never
# run an event - the brief's "some should have very few events".
NEW_CLUBS = [
    ("APU Robotics Club", "Builds competition robots and runs open build nights every Thursday.",
     ["Technology", "Academic"], 34, "high"),
    ("Debate and Public Speaking Society", "Weekly parliamentary debate practice and inter-university tournaments.",
     ["Academic", "Special Interest"], 28, "high"),
    ("APU Volunteers Network", "Runs food drives, beach clean-ups and shelter visits across the Klang Valley.",
     ["Community Service"], 52, "high"),
    ("Esports Club", "Competitive Valorant, Dota and mobile-legends squads plus casual LAN nights.",
     ["Special Interest", "Sports"], 61, "medium"),
    ("Culinary Arts Circle", "Cooking demos, cultural food nights and campus food-market stalls.",
     ["Arts & Culture", "Special Interest"], 23, "medium"),
    ("APU Basketball Team", "Trains three evenings a week and represents APU at inter-varsity level.",
     ["Sports"], 19, "medium"),
    ("Film and Media Collective", "Short-film production, screening nights and a student film festival.",
     ["Arts & Culture"], 17, "low"),
    ("Entrepreneurship Hub", "Pitch nights, founder AMAs and a semester-long startup incubator.",
     ["Academic", "Special Interest"], 26, "low"),
    ("Green Campus Initiative", "Recycling drives, campus biodiversity surveys and sustainability advocacy.",
     ["Community Service", "Special Interest"], 14, "low"),
    ("Japanese Culture Society", "Language exchange, calligraphy workshops and an annual matsuri.",
     ["Arts & Culture"], 21, "none"),
    ("Chess and Strategy Club", "Rapid tournaments, puzzle nights and a campus ladder ranking.",
     ["Special Interest"], 11, "none"),
]

# --- Venues ----------------------------------------------------------------
VENUES = [
    "Auditorium", "Grand Hall", "Main Hall", "Level 6 Multipurpose Hall",
    "Seminar Room 1", "Seminar Room 2", "Lecture Theatre 3", "Lecture Theatre 5",
    "Innovation Lab", "Campus Green", "Basketball Court", "Library Discussion Zone",
    "Atrium Concourse", "Block D Studio", "Sports Complex", "Boardroom A",
]

# --- Event catalogue -------------------------------------------------------
# (title, short introduction, goals, benefits, [category ids], pax, kind)
# `kind` picks the requirement mix (see seed_production.REQUIREMENT_MIX) and the
# default venue class. Category ids are event_category rows seeded by seed/run.py:
#   1 Academic & Career   2 Workshops & Training  3 Sports & Wellness
#   4 Culture & Community 5 Clubs & Societies     6 Entertainment & Social
#   7 Volunteering
EVENTS = [
    # --- Career and academic -------------------------------------------------
    ("Graduate Employability Summit", "A full-day summit with recruiters from 30 employers across tech, finance and engineering.",
     "Put final-year students in front of the companies actually hiring this intake.", "Interview slots, CV clinics and a clearer picture of graduate salary bands.", [1], 420, "fair"),
    ("Fintech Careers Night", "An evening panel with hiring managers from four Malaysian fintech firms.",
     "Demystify the fintech hiring pipeline for Computing and Business students.", "Direct contact with hiring managers and a published list of open internships.", [1], 140, "seminar"),
    ("Industry Advisory Panel Briefing", "Industry advisors meet faculty to review the curriculum against current practice.",
     "Keep module content aligned with what employers are asking for.", "Curriculum changes traceable to named industry feedback.", [1], 40, "meeting"),
    ("Postgraduate Research Showcase", "Postgraduate researchers present work in progress across three parallel tracks.",
     "Surface ongoing research and find cross-school collaborators.", "New supervisory pairings and two joint-paper commitments each year.", [1], 95, "conference"),
    ("Internship Placement Fair", "Employers with live internship vacancies meet second and third year students.",
     "Fill the semester internship quota before the placement window closes.", "Students secure placements without cold-applying.", [1], 260, "fair"),
    ("Alumni Homecoming Dinner", "Graduates from the last ten intakes return for dinner and a keynote.",
     "Rebuild the alumni network and open a mentoring pipeline.", "A standing alumni mentor pool for final-year students.", [1, 4], 180, "dinner"),
    ("Academic Integrity Briefing", "Compulsory briefing on citation, collusion and the use of generative AI in assessment.",
     "Cut the academic-misconduct case load by making the rules unambiguous.", "Fewer misconduct panels and clearer marking outcomes.", [1], 300, "seminar"),
    ("Study Abroad Information Session", "Partner-university representatives explain exchange options and funding.",
     "Increase exchange uptake beyond the usual two or three students a year.", "Concrete application deadlines and a funding checklist.", [1], 70, "seminar"),

    # --- Workshops and training ---------------------------------------------
    ("Cloud Native Bootcamp", "Three-day hands-on bootcamp on containers, Kubernetes and CI pipelines.",
     "Get students production-competent with the tooling employers actually run.", "A deployed personal project and a shareable certificate.", [2], 60, "workshop"),
    ("Data Visualisation Workshop", "Practical session on turning messy datasets into defensible charts.",
     "Raise the standard of charts in final-year projects.", "Students leave with a reusable chart template pack.", [2], 45, "workshop"),
    ("Public Speaking Intensive", "Half-day intensive with a professional speaking coach.",
     "Build presentation confidence before capstone defences.", "Measurable improvement in defence presentation marks.", [2], 35, "workshop"),
    ("Cybersecurity Capture the Flag", "Six-hour CTF with beginner, intermediate and open tracks.",
     "Grow the security interest group and select the inter-varsity CTF team.", "A ranked team roster and three new security-track projects.", [2, 5], 88, "hackathon"),
    ("UI/UX Design Sprint", "A compressed design sprint from problem framing to a clickable prototype.",
     "Teach the sprint method by running one end to end.", "A portfolio-ready prototype for every participant.", [2], 40, "workshop"),
    ("Financial Literacy for Students", "Budgeting, PTPTN repayment and first-job tax, explained plainly.",
     "Reduce financial stress cases reported to Student Services.", "Students leave with a personal budget they have actually filled in.", [2], 120, "seminar"),
    ("Research Methods Refresher", "Refresher on sampling, ethics approval and writing a defensible methodology.",
     "Cut the number of ethics submissions returned for revision.", "Faster ethics turnaround and stronger methodology chapters.", [2], 55, "workshop"),
    ("Git and Collaboration Clinic", "Drop-in clinic on branching, code review and resolving merge conflicts.",
     "Stop group projects losing work the week before submission.", "Fewer lost-work incidents reported during assessment.", [2], 50, "workshop"),
    ("Machine Learning Study Jam", "Four-week study jam working through a shared ML curriculum.",
     "Give students a structured route into ML outside module hours.", "A cohort that finishes with a trained model each.", [2], 65, "workshop"),
    ("Grant Writing Workshop for Staff", "Internal workshop on structuring a competitive research grant application.",
     "Increase the School's external grant submission rate.", "More submissions, and reviewers who know what gets funded.", [2], 28, "workshop"),

    # --- Competitions and hackathons ----------------------------------------
    ("APU Hackathon 2026", "Thirty-six hours, mixed teams, three sponsor challenge tracks.",
     "Produce shippable prototypes against real sponsor problems.", "Sponsor-funded prizes and two prototypes taken further by sponsors.", [2, 5], 240, "hackathon"),
    ("Inter-School Case Competition", "Business case competition judged by practising consultants.",
     "Sharpen structured problem-solving under time pressure.", "A recruiting shortlist drawn directly from the finalists.", [1, 5], 130, "competition"),
    ("Robotics Grand Challenge", "Autonomous robots race an obstacle course built by the Robotics Club.",
     "Showcase Engineering project work to the whole campus.", "Recruitment pipeline for the Robotics Club and Engineering open day.", [2, 5], 200, "competition"),
    ("Programming Contest Qualifier", "ICPC-style qualifier to pick the university team.",
     "Select and then train a competitive programming squad.", "A ranked squad with a season of practice ahead of it.", [1, 5], 75, "competition"),
    ("Startup Pitch Night", "Ten student teams pitch to a panel of angel investors and founders.",
     "Move student ideas from slide deck to funded pilot.", "Two teams typically leave with seed conversations open.", [1, 5], 160, "competition"),
    ("Photography Contest Exhibition", "Winning entries from the semester photo contest, printed and hung.",
     "Give the Photography Club a public showcase.", "A permanent print collection for the campus corridors.", [4, 5], 110, "exhibition"),

    # --- Culture and community ----------------------------------------------
    ("Deepavali Open House", "Campus-wide open house with food, rangoli and a cultural performance set.",
     "Bring the whole campus into one shared celebration.", "Stronger cross-cultural relationships across cohorts.", [4], 500, "festival"),
    ("Chinese New Year Celebration", "Lion dance, mandarin orange giveaway and a reunion-style lunch.",
     "Mark the festival for students who cannot travel home.", "Community for international and out-of-state students.", [4], 450, "festival"),
    ("Hari Raya Aidilfitri Gathering", "Open house with rendang, ketupat and a takbir performance.",
     "Keep the Raya tradition alive on campus for students staying back.", "A campus that feels like home during the break.", [4], 380, "festival"),
    ("International Food Festival", "Student societies run food stalls representing fifteen countries.",
     "Celebrate the international cohort through what they cook.", "Society fundraising and a genuinely packed concourse.", [4, 6], 600, "festival"),
    ("Merdeka Day Flag Ceremony", "Flag-raising ceremony, national anthem and a short historical address.",
     "Mark Independence Day formally as a campus.", "A shared civic moment at the start of the semester.", [4], 320, "ceremony"),
    ("Cultural Night: Rhythms of Asia", "An evening of dance and music from six student cultural groups.",
     "Give the cultural societies a proper production stage.", "Rehearsed, high-production performances instead of corridor practice.", [4, 6], 400, "concert"),
    ("Mid-Autumn Lantern Walk", "Lantern walk around the campus lake with mooncake tasting.",
     "A low-key evening event for students staying on campus.", "Quiet community-building in the middle of assessment season.", [4], 150, "festival"),

    # --- Sports and wellness -------------------------------------------------
    ("Inter-School Futsal Tournament", "Group stage plus knockouts across four Schools over two weekends.",
     "Build School identity through competition.", "A regular sporting fixture students plan their weekends around.", [3], 220, "sports"),
    ("Campus Fun Run 5K", "A 5K route around campus and the surrounding park, open to staff and family.",
     "Get a broad, non-athletic population moving.", "The highest staff participation of any campus event.", [3], 340, "sports"),
    ("Basketball Friendly vs Taylor's", "Home fixture against Taylor's University, mens and womens teams.",
     "Give the basketball squads competitive fixtures.", "A supporter base that shows up for home games.", [3], 180, "sports"),
    ("Mental Health Awareness Week", "Talks, drop-in counselling and low-stimulus quiet rooms across five days.",
     "Normalise using counselling before things get critical.", "Earlier self-referrals and less crisis-point demand.", [3], 260, "seminar"),
    ("Yoga and Mindfulness Sessions", "Six weekly sessions in the multipurpose hall, mats provided.",
     "Give students a routine reset during assessment weeks.", "A repeat cohort that keeps coming back each semester.", [3], 40, "wellness"),
    ("Blood Donation Drive", "Joint drive with the National Blood Centre, two donation bays.",
     "Meet the hospital's quarterly campus collection target.", "A reliable donor base and a repeatable logistics template.", [3, 7], 200, "drive"),
    ("Badminton Open Championship", "Singles and doubles across two days in the sports complex.",
     "Run the most-requested sport as a proper championship.", "A ranked campus ladder for the following semester.", [3], 150, "sports"),

    # --- Volunteering and community service ---------------------------------
    ("Beach Clean-Up at Port Dickson", "Coach transfer to Port Dickson for a half-day shoreline clean-up.",
     "Contribute measurable volunteer hours to a coastal clean-up partner.", "Logged volunteer hours and a documented waste audit.", [7], 90, "offsite"),
    ("Orphanage Visit and Learning Day", "Volunteers run reading and STEM activities at a partner shelter.",
     "Sustain the shelter partnership beyond one-off festive visits.", "A repeatable termly programme rather than a photo opportunity.", [7], 45, "offsite"),
    ("Food Bank Packing Day", "Sorting and packing donated goods for distribution to B40 families.",
     "Clear the partner food bank's backlog before month-end distribution.", "A tangible, same-day outcome for first-time volunteers.", [7], 60, "drive"),
    ("Community Tech Literacy Clinic", "Students teach basic smartphone and e-government skills to senior citizens.",
     "Apply Computing skills to a non-technical audience.", "Volunteers learn to explain technology without jargon.", [7, 2], 50, "workshop"),
    ("Charity Bazaar for Flood Relief", "Stalls run by societies, all proceeds to a flood relief fund.",
     "Raise relief funds and give societies a fundraising channel.", "Funds raised and a template for the next emergency appeal.", [7, 6], 280, "festival"),

    # --- Recruitment, orientation and society life --------------------------
    ("Club Recruitment Carnival", "Every registered club takes a booth for a two-day recruitment drive.",
     "Get first-years into at least one society in their first month.", "Higher club retention across the whole academic year.", [5], 700, "fair"),
    ("New Student Orientation Day", "Campus tour, systems walkthrough and School welcome sessions.",
     "Get new intakes oriented before teaching week one.", "Fewer first-week support tickets and lost students.", [5, 1], 480, "orientation"),
    ("Society Leaders Training Day", "Committee training on budgeting, event proposals and safeguarding.",
     "Raise the standard of club-run events across the board.", "Proposals that arrive complete instead of being sent back.", [5, 2], 65, "workshop"),
    ("Robotics Club Open Build Night", "Open workshop night where anyone can join a build team.",
     "Convert curiosity into committed build-team members.", "A steady intake of new builders each semester.", [5], 30, "workshop"),
    ("Esports Campus LAN Night", "Overnight LAN with three tournament brackets and casual stations.",
     "Give the esports community a proper social fixture.", "A visible, well-run community rather than scattered play.", [5, 6], 140, "gaming"),
    ("Debate Society Open Floor", "Open-floor debate on a current motion, no experience required.",
     "Lower the barrier to entry for competitive debating.", "New members who joined without prior debating background.", [5], 55, "seminar"),
    ("Volunteers Network Induction", "Induction and safeguarding briefing for new volunteer sign-ups.",
     "Make sure every volunteer is briefed before their first placement.", "Safe, compliant volunteering with a clear record.", [5, 7], 70, "seminar"),

    # --- Entertainment and social -------------------------------------------
    ("Annual Dinner and Awards Night", "Black-tie dinner with student achievement awards and a live band.",
     "Close the academic year by recognising student achievement properly.", "Public recognition that students actually put on a CV.", [6], 350, "dinner"),
    ("Open Mic and Busking Night", "Acoustic sets from student performers on the concourse stage.",
     "Give performers a low-pressure stage outside the big shows.", "A regular fixture that builds a performer community.", [6], 120, "concert"),
    ("Movie Night Under the Stars", "Outdoor screening on the campus green with bean bags and popcorn.",
     "A cheap, high-turnout social event during exam recovery week.", "Downtime that does not require anyone to leave campus.", [6], 200, "screening"),
    ("Semester Closing Party", "End-of-semester social with a DJ set and a photo wall.",
     "Mark the end of assessment and release the pressure.", "A shared finish line for the whole cohort.", [6], 300, "concert"),
    ("Board Game and Trivia Night", "Board games, a pub-style trivia round and free supper.",
     "A social option for students who do not want a loud party.", "Inclusive social space with a repeat attendance pattern.", [6], 80, "gaming"),

    # --- Open days and campus tours -----------------------------------------
    ("Campus Open Day for Schools", "Prospective students and parents tour campus and sit in on demo classes.",
     "Convert enquiries into applications for the January intake.", "Measurable application uplift attributable to the day.", [1], 550, "openday"),
    ("Engineering Facilities Tour", "Guided tour of the fabrication, electronics and materials labs.",
     "Show prospective Engineering students the facilities up close.", "Applicants who have actually seen where they would study.", [1], 60, "tour"),
    ("Parents Information Evening", "Briefing for parents on programme structure, fees and support services.",
     "Answer parent questions directly instead of through students.", "Fewer escalated parent enquiries mid-semester.", [1], 150, "seminar"),
    ("Sponsor Site Visit", "Sponsor delegation tours labs and meets scholarship recipients.",
     "Keep the sponsor engaged ahead of the funding renewal.", "Renewed sponsorship and two new scholarship places.", [1], 25, "tour"),

    # --- Internal and staff-facing ------------------------------------------
    ("Faculty Development Day", "Internal staff development on assessment design and rubrics.",
     "Bring marking practice into line across module teams.", "More consistent marking and fewer moderation disputes.", [2], 85, "workshop"),
    ("Department Heads Quarterly Review", "Heads review service SLAs, backlogs and the coming quarter's demand.",
     "Get every service department onto one operational picture.", "Fewer surprises and a shared capacity forecast.", [1], 22, "meeting"),
    ("Finance Office Budget Briefing", "Briefing on the new financial year's event budget envelope and codes.",
     "Make sure budget holders code spending correctly from day one.", "Cleaner reconciliation and fewer rejected claims.", [1], 45, "meeting"),
    ("New Staff Induction", "Onboarding day for staff who joined in the last quarter.",
     "Get new staff productive without three months of asking around.", "Shorter ramp-up and fewer repeated onboarding questions.", [2], 30, "orientation"),
]
