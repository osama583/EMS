# -*- coding: utf-8 -*-
"""Comparative justification for every method and tool the report selects.

The report already said what each chosen option is good at. That is not a
justification, because the options it beat are good at things too. Each entry
below names the alternatives that were actually available for that decision,
says why each was set aside, and then defends the selection against them on a
property of this system rather than on the tool's general merits.

Each operation is (anchor_substring, mode, [paragraphs]). The anchor is matched
on paragraph text, so an edit survives the paragraph indices moving.
    'after'   insert the paragraphs immediately after the anchor
    'before'  insert them immediately before it
    'replace' replace the anchor's text with the single paragraph given
"""
from __future__ import annotations

OPERATIONS = [

    # ---- 2.4 opening: announce the comparative form ------------------------
    ("identifies and justifies all technical components", "replace", [
        "This section identifies and justifies all technical components selected for the "
        "development of the proposed centralized, role-based event coordination platform for "
        "APU. Each component is presented in the same form. The alternatives that were "
        "realistically available for that decision are named, the reason each was set aside is "
        "given, and the selected option is then defended against them rather than in isolation. "
        "This form is used deliberately, because a list of a tool's advantages is not a "
        "justification: the rejected alternatives carry advantages of their own, and in several "
        "cases the rejected option is the more common industry choice. What settles each case is "
        "the fit between what a tool does well and what this particular system demands, which is "
        "a multi-departmental approval workflow whose access rules are unusual, whose data is "
        "strongly relational, and which is built and maintained by one developer within a single "
        "academic year.",
    ]),

    # ---- 2.4.2 IDE ---------------------------------------------------------
    ("ranked as the most popular developer environment tool", "after", [
        "Three alternatives were considered against it. The JetBrains family offers the deepest "
        "language-specific tooling of the group, but its coverage is split across two separate "
        "products, PyCharm for the Flask tier and WebStorm for the Angular tier, so adopting it "
        "would have meant two editors, two sets of configuration and two paid licences for a "
        "single codebase. Visual Studio provides comparable depth on Windows but is weighted "
        "towards the .NET ecosystem, which this project does not use. Lightweight editors such as "
        "Sublime Text and Vim start faster and cost nothing, but language support, debugging and "
        "version control must be assembled from separate plugins by the developer rather than "
        "being present by default, which shifts effort from writing the system to configuring the "
        "tool used to write it.",

        "The deciding factor is the shape of the work rather than the strength of any one editor. "
        "This project is written by a single developer who moves between an Angular component and "
        "the Flask route that serves it many times in the same session, so the cost that matters "
        "is the cost of crossing between TypeScript, SCSS, Python and SQL, not the depth of the "
        "tooling within any one of them. Visual Studio Code is the only one of the four candidates "
        "that covers all four languages in one free installation with an integrated debugger and "
        "version control, which is why it was preferred over tools that are individually stronger "
        "across a narrower range.",
    ]),

    # ---- 2.4.3 A: Angular --------------------------------------------------
    ("As stated by Vashisht (2021), Angular is distinguished", "after", [
        "Four alternatives were weighed against Angular. React is the most widely used of them, "
        "but it is a library rather than a framework: routing, form handling, HTTP access and "
        "state management are supplied by separate packages chosen by the developer. For a team "
        "with established conventions that freedom is an advantage; for a single student building "
        "a twelve-role application to a fixed deadline it becomes a series of architectural "
        "decisions that must each be researched and defended before any feature is written. Vue "
        "offers a gentler learning curve and a lower initial cost, but it is less opinionated "
        "about structure and treats TypeScript as an option rather than as the default. Svelte "
        "compiles to smaller and faster output, and Vashisht (2021) reports exactly that advantage "
        "in a direct comparison with Angular, while identifying Angular's own advantage as the "
        "completeness of its tooling for large and complex applications. Building the interface in "
        "HTML and JavaScript with no framework at all was also considered, and rejected because "
        "routing, validation and session handling would then all have been written by hand.",

        "Angular was selected because the properties this system needs are the ones it supplies as "
        "first-party parts of the framework rather than as choices to be made. The application has "
        "twelve roles whose menus differ, a six-step proposal form with staged validation, and an "
        "HTTP layer in which every outbound request must carry the caller's token and every "
        "authentication failure must be handled identically. Angular provides routing with guards, "
        "reactive forms, dependency injection and HTTP interceptors as one documented mechanism "
        "each. The route guard and the token interceptor described in Sections 4.6.3 and 4.6.4 are "
        "configurations of framework features; in React or in plain JavaScript the same behaviour "
        "would have been the developer's own code, and the access model would then have depended "
        "on that code being written correctly in every place it was needed. Svelte's advantage in "
        "output size was judged the less valuable of the two, because the platform is used by "
        "staff on campus networks rather than by anonymous visitors on constrained connections, so "
        "the characteristic it improves is not the one under pressure here.",
    ]),

    # ---- 2.4.3 B: Flask ----------------------------------------------------
    ("In the developed system, the backend is organised into resource-based modules", "after", [
        "Four backend alternatives were considered, and the strongest of them was rejected for a "
        "reason specific to this system. Django supplies an object-relational mapper, an "
        "administrative interface and a complete authentication and permission system out of the "
        "box, and on that basis it is the more productive starting point for most applications. "
        "Its permission model, however, is defined per model and held globally per user, whereas "
        "authority in this system is held by a user in a role within an organisational unit, as "
        "described in Section 4.2.3. Adopting Django would have meant overriding its permission "
        "system rather than using it, which removes most of the advantage that made it a "
        "candidate. FastAPI is newer, generates its own API documentation, and handles requests "
        "asynchronously, which is a real advantage for workloads dominated by concurrent input and "
        "output; this workload is a departmental approval queue with a bounded user population and "
        "database-bound requests, where that advantage does not apply, and its body of published "
        "guidance is smaller than Flask's (Albesher & Alfayez, 2024). Node.js with Express would "
        "have allowed one language across both tiers, but it would have placed the assistant, the "
        "query guard and the scheduled jobs in JavaScript and away from the Python libraries they "
        "depend on, including the Gemini software development kit and the password hashing and "
        "migration tooling used here. Spring Boot and ASP.NET Core are both proven for "
        "institutional systems of this kind, but each carries a configuration and build burden "
        "disproportionate to a project written by one person.",

        "Flask was selected precisely because it imposes little. The three-layer separation "
        "described in Section 4.2.2, in which a route may not issue SQL and a change to a request "
        "must pass through the workflow service that writes its audit record, is an arrangement "
        "designed around this system's workflow rather than inherited from a framework's "
        "conventions. A more complete framework would have supplied its own answers to "
        "authorisation, data access and request routing, and in each of those three places this "
        "system needs a different answer: authority scoped to a unit, explicit SQL for the "
        "multi-stage approval queries, and an audit write bound to the same transaction as the "
        "state change it records. The absence of those defaults is the reason Flask was chosen "
        "over Django, and it is equally the cost of the choice, since everything a fuller "
        "framework would have provided had to be built instead and is accounted for in the "
        "implementation described in Chapter 4.",
    ]),

    # ---- 2.4.3 C: supporting libraries (data access and session handling) ---
    ("Google Gemini (AI Assistant)", "before", [
        "Two of the decisions represented in the table above are worth setting against the "
        "alternatives they were chosen over. The first is data access. The conventional pairing "
        "with Flask is SQLAlchemy, an object-relational mapper that maps tables onto Python "
        "classes and removes most hand-written SQL from the application. It was rejected here "
        "because the queries that matter most in this system are the multi-stage approval queries "
        "and the scope-filtered list queries, and in both of them the filtering condition is the "
        "security boundary rather than a convenience. An object-relational mapper would either "
        "generate those conditions out of sight or require raw SQL to be embedded within it "
        "anyway, while adding a mapping layer that must itself be maintained. Writing "
        "parameterised SQL directly keeps the condition that enforces access visible in the query "
        "text, at the acknowledged cost of portability between database engines, which this "
        "project does not need because the engine is fixed.",

        "The second is session handling. Server-side sessions carried in cookies are the older and "
        "simpler approach, and they hold one clear advantage over tokens: a session can be "
        "destroyed on the server at the moment access is withdrawn, whereas a signed token remains "
        "valid until it expires. They were nevertheless rejected, because the Angular client and "
        "the Flask API are served as separate origins, and cookie-based sessions across origins "
        "require cross-site cookie configuration together with separate protection against "
        "cross-site request forgery. JSON Web Tokens avoid both, and are an established approach "
        "for exactly this separation of client and server (Dalimunthe et al., 2023). The "
        "revocation weakness that argues for sessions was answered in the design rather than "
        "ignored: as described in Section 4.2.3, the caller's roles are read from the database on "
        "every request instead of being trusted from the token's claims, so withdrawing a role "
        "takes effect on the next request rather than when the token happens to expire.",
    ]),

    # ---- 2.4.3 D: Gemini ---------------------------------------------------
    ("Google Gemini was selected because it is reached through a documented", "after", [
        "The first alternative to the assistant is not another model but no model at all. The same "
        "questions could be answered by adding further reporting screens, and that option was "
        "considered first because it introduces no external dependency and no new failure mode. It "
        "was set aside because the number of screens grows with the number of roles and each "
        "screen answers only the questions it was designed for, whereas the questions staff "
        "actually ask cut across roles and were not known in advance. A self-hosted open-weight "
        "model such as Llama or Mistral was the next candidate, and it is the stronger option on "
        "confidentiality, since no institutional data would leave the host, and on cost, since "
        "there is no per-request charge. It was rejected on the resources available: it requires a "
        "continuously running machine with a suitable graphics processor, which this project does "
        "not have, and accuracy on the text-to-SQL task for models of the size such a machine "
        "could host remains materially below that of the current hosted models (Shi et al., 2025).",

        "Among the hosted models, Gemini, the OpenAI models and Anthropic's Claude are close "
        "enough in capability on this task that the choice between them is not a capability "
        "judgement. Gemini was taken because it is reachable through a documented software "
        "development kit at a usage tier the project can afford, and because two credentials can "
        "be configured with automatic failover between them, which matters for a component that "
        "has to work during a live demonstration. The more important point is that the design does "
        "not depend on which of the three was chosen. The model is only permitted to propose a "
        "query; the guard described in Section 4.6.11 then validates that query and constrains it "
        "to the asking user's own access rights before it is executed. Because the safety of the "
        "assistant rests on the guard rather than on the model behaving well, the provider can be "
        "replaced without weakening it, and the selection was made on that understanding.",
    ]),

    # ---- 2.4.4 DBMS --------------------------------------------------------
    ("Third, the database is hosted on Supabase as a managed service", "after", [
        "This choice was made in two parts, and each part had realistic alternatives. On the "
        "question of data model, MongoDB was the principal non-relational candidate. A document "
        "store is the better fit where records are self-contained and their shape varies between "
        "them; here a single event request refers to a user, an organisational unit, a role "
        "assignment, a set of departmental tasks, a venue and, where catering is ordered, a "
        "cafeteria menu. Keeping those references valid is the property the system depends on, and "
        "in a document store it would have to be enforced by the application rather than by the "
        "database. Urnikienė et al. (2026) also report PostgreSQL's advantage over MongoDB on "
        "precisely the filtering and analytical query patterns that the dashboards in this system "
        "perform. MySQL was the closest relational alternative and would have served, but Salunke "
        "and Ouda (2024) report stronger performance for PostgreSQL in direct comparison, and "
        "PostgreSQL's stricter treatment of constraints was preferred for a system whose "
        "correctness claims rest on them. SQLite was used during early development and rejected "
        "for delivery, because it is a single-writer file database and this system has concurrent "
        "approvers acting on the same request while a scheduled escalation job writes to it in the "
        "background.",

        "Firebase, with its Firestore database, was considered separately, because it would have "
        "supplied hosting, authentication and file storage as one service and removed several "
        "other decisions at once. It was rejected on the same ground that ruled out Django's "
        "permission system. Firestore expresses access control as per-document security rules, "
        "whereas the model here is a role held within a unit, applied as a filtering condition on "
        "list queries so that records outside a caller's scope are never retrieved at all. That "
        "condition is a single clause in SQL and an awkward reconstruction in a document rule "
        "language. Firestore also offers no equivalent of the multi-table transaction on which the "
        "audit guarantee depends, since a state change and the history record describing it must "
        "either both be written or neither be written.",

        "The second part of the choice was where the database runs, and it was decided separately "
        "from which database it is. Running PostgreSQL on the development machine keeps everything "
        "local and free, but it ties the institution's data to one student's computer and provides "
        "no backup. Running it on university infrastructure would be the correct answer in "
        "production and was not available, because it requires a provisioning decision outside a "
        "student project's control. Supabase was taken because it supplies the instance, its "
        "backups and the connection pooling used by the application, which are the parts of "
        "database administration that a single developer is least able to guarantee, while leaving "
        "the schema itself under the project's own versioned migration runner rather than under "
        "the vendor's control.",
    ]),

    # ---- 2.4.5 operating system -------------------------------------------
    ("The system is web-based and is not bound to any specific client operating system", "after", [
        "Development could equally have been carried out on Linux or macOS, and containerising the "
        "application with Docker was considered as a way of making the development environment "
        "identical to the deployment environment. Containers were set aside as disproportionate "
        "for a single-developer project with one deployment target, since the isolation they "
        "provide addresses a problem that arises when several services and several developers must "
        "agree on an environment, and neither condition holds here. Windows was used because it is "
        "the machine available, and the risk that ordinarily argues for containers is contained "
        "instead by two facts about this system: the Flask application depends on no "
        "platform-specific behaviour, and the database is the same managed instance from every "
        "environment, so there is no local copy that can drift out of step with it.",
    ]),

    # ---- 2.4.6 deployment --------------------------------------------------
    ("Both are addressed by moving the application tier to a hosted environment", "after", [
        "Four hosting arrangements were compared before this one was adopted. A fully managed "
        "application platform such as Render or Railway would have hosted the API alongside the "
        "database and removed server administration entirely; it was rejected because the free "
        "tiers that fit this project's budget suspend an idle instance, and a suspended instance "
        "cannot run the scheduled sweep that sends event reminders and escalates overdue "
        "approvals, which is a behaviour the system is assessed on. A virtual machine on a cloud "
        "provider was the next candidate, and it is the route taken by Arriesgado et al. (2023) "
        "for a comparable campus event management system; it gives full control and a permanently "
        "running host, at the price of transferring operating system patching, certificate renewal "
        "and backup onto one student for the duration of the project, for a system that carries no "
        "external users during assessment. A containerised deployment under an orchestrator was "
        "rejected as disproportionate for the same reason containers were rejected for "
        "development, since orchestration exists to scale and coordinate many service instances "
        "and this system runs one of each. Hosting the whole platform on university infrastructure "
        "would be the correct production answer and remains the recommendation in Section 6.3, but "
        "it depends on an institutional provisioning decision that a final year project cannot "
        "make.",

        "The arrangement adopted splits the decision rather than answering it once, and it splits "
        "it along the line that separates what can be rebuilt from what cannot. The application "
        "tier can be reconstructed from source on any machine in minutes, so it was left local, "
        "where it costs nothing and is always available for development and demonstration. The "
        "database holds the only state that cannot be reconstructed, so it is the component placed "
        "under managed hosting, where it is backed up and reachable from every environment. This "
        "is why the split was preferred over the two consistent alternatives: hosting everything "
        "locally would have made the data dependent on a single machine, and hosting everything "
        "remotely would have added recurring cost and administration for a tier that needs "
        "neither.",
    ]),

    # ---- 2.4.7 browsers ----------------------------------------------------
    ("consistent rendering and JavaScript execution are essential", "after", [
        "The alternatives here concern how wide the supported set should be rather than which "
        "browsers exist. Targeting a single browser is the cheapest option and would have halved "
        "the verification work; it was rejected on the evidence Choudhary et al. (2012) present, "
        "since a system verified on one engine carries no evidence about its behaviour on another. "
        "Declaring support for every current browser, including Safari and the older engines still "
        "present on some managed machines, was rejected for the opposite reason: each additional "
        "engine is a further full pass of the test plan, and Safari in particular cannot be "
        "exercised from the Windows development machine used for this project, so support for it "
        "could have been claimed but not demonstrated. Building a native desktop or mobile "
        "application instead of a web client was also considered, and rejected because it would "
        "require a separate build for each platform and an installation step on university "
        "machines that staff are not permitted to perform themselves, while the responsive web "
        "client already reaches mobile devices without one.",

        "Chrome and Firefox were chosen as the pair because they are built on independent "
        "rendering engines, Blink and Gecko. That is the property that makes the pair meaningful, "
        "rather than the popularity of either browser: verifying on Chrome and Microsoft Edge "
        "would have covered a large share of users while testing the same engine twice and "
        "demonstrating nothing about cross-engine behaviour. Two independent engines is therefore "
        "the smallest set that provides real evidence of the portability the system claims, and "
        "the largest set this project can re-test on every release without the verification effort "
        "displacing the development it exists to support.",
    ]),

    # ---- 2.5 summary -------------------------------------------------------
    ("This chapter presented a literature review supporting the proposed", "replace", [
        "This chapter presented a literature review supporting the proposed centralized, "
        "role-based event coordination platform for APU. It covered three main areas: domain "
        "research, similar systems, and technical justification. Domain research examined event "
        "management in academic institutions, multi-departmental coordination, RBAC systems, "
        "centralized platforms, and SDG Goal 9 in higher education. Similar systems included "
        "studies by Alesandro et al. (2025), Abdul Rahman et al. (2024), and Essel et al. (2023), "
        "as well as a review of Cvent (2025), focusing on campus event management and clearance "
        "management systems. Technical research justified the use of Visual Studio Code, Angular, "
        "Flask (Python), PostgreSQL hosted on Supabase, the supporting libraries used across both "
        "tiers, the Google Gemini model behind the platform's AI assistant, and the deployment and "
        "hosting arrangement adopted for the system. Each of those decisions was argued against "
        "the alternatives available for it rather than on its own merits alone, and where the "
        "rejected option is the more common industry choice, the reason it was set aside is stated "
        "in terms of what this system requires rather than in terms of what the tool lacks.",
    ]),

    # ---- 3.4 pure vs hybrid: the cost of the hybrid ------------------------
    ("Therefore, compared to pure methodologies, hybrid approaches", "after", [
        "The case for a hybrid should not be made without stating its risk, since a process that "
        "borrows from two models can as easily inherit the weaknesses of both, and become a "
        "licence to plan less than Waterfall requires while iterating less than Agile expects. "
        "Hron and Obwegeser (2018) describe adaptation of this kind as ordinary practice rather "
        "than as a failure of discipline, but adaptation is only defensible when what is taken "
        "from each model, and what is left behind, are stated in advance. That is the condition "
        "applied in the following section. The Waterfall element is confined to the phases whose "
        "output is a fixed artefact, the Agile element is confined to implementation, and the "
        "prototyping element is confined to the interface, so that each part of the process is "
        "governed by one model rather than by a negotiation between two.",
    ]),

    # ---- 3.5 why the three pure methodologies were rejected ----------------
    ("Overall, the selected methodology provides a comprehensive framework", "before", [
        "The three pure alternatives were rejected on specific grounds rather than on general "
        "preference, and each was rejected only in part. Waterfall was set aside because its "
        "central assumption does not hold for this project. It is at its strongest where "
        "requirements are settled before design begins, and Srivastava (2019) identifies those "
        "conditions as the ones that favour it. Here the departmental requirements were not "
        "settled: the fields a cafeteria request needs, and the point at which a rejected proposal "
        "returns to its applicant, were established during implementation, in discussion with the "
        "supervisor and by observing where the interface failed. Under a pure Waterfall process "
        "those discoveries would have arrived after the design phase had been signed off, and each "
        "would have been a change against a frozen specification rather than an ordinary revision. "
        "What Waterfall does supply, a documented architecture fixed before implementation begins, "
        "was retained in the hybrid rather than discarded along with it.",

        "A pure Scrum implementation was rejected for a reason of scale rather than of principle. "
        "Scrum's mechanisms are designed to coordinate a team: the daily stand-up synchronises "
        "people who cannot otherwise see each other's work, the retrospective surfaces problems in "
        "how a group is working together, and the separation of Product Owner from Scrum Master "
        "divides the decision about what to build from the decision about how to build it. Kadenic "
        "et al. (2023) tie the benefit Scrum delivers to team maturity and to the presence of "
        "those components. With one developer none of the coordination problems they solve exist, "
        "and performing the ceremonies would produce a record of a team's dynamics where there is "
        "no team. The parts of Scrum whose value does not depend on team size, short time-boxed "
        "iterations and testing carried out continuously rather than at the end, were kept.",

        "Rapid Application Development came closest to being adopted outright, since prototyping "
        "is central to this project and the requirement gap it addresses was real. It was rejected "
        "as a complete methodology because it de-emphasises the planning phase, and the elements "
        "of this system that must not be revised late are precisely the ones it would defer: the "
        "identity model that pairs a user, a role and an organisational unit, and the "
        "transactional guarantee that binds an audit record to the state change it describes. Both "
        "are foundations that everything else is built against, and reworking either after "
        "implementation had begun would have propagated through the whole system. Thesing et al. "
        "(2021) treat the choice between plan-driven and iterative approaches as a decision to be "
        "made for each project against its own characteristics rather than adopted wholesale, "
        "which is the reasoning applied here: prototyping was taken from RAD and applied to the "
        "interface, where late change is cheap, while the architecture was settled first under the "
        "plan-driven part of the process, where late change is not.",
    ]),

    # ---- 3.7.1 data collection method --------------------------------------
    ("The data gathering process for this project was conducted using a survey-based approach",
     "after", [
        "Three alternatives were considered before the survey was chosen. Semi-structured "
        "interviews would have produced a richer account of how coordination currently fails and "
        "would have allowed each answer to be followed up; they were set aside because the "
        "question at this stage was whether the difficulties are widespread rather than how one "
        "person experiences them, and the number of participants who can be interviewed within the "
        "project timetable is too small to settle that. Focus groups were rejected on two grounds: "
        "assembling students and staff from several departments at one time is difficult within a "
        "semester, and a group setting removes the anonymity that matters when participants are "
        "asked to describe shortcomings in their own institution's processes, with the further "
        "risk that a senior participant's view shapes the responses of the others. Direct "
        "observation of the existing process would have given the most faithful picture of the "
        "three, but a single event cycle runs over several weeks and passes through departmental "
        "steps that a student has no access to observe.",

        "Analysis of existing documentation was considered as a fourth option and could not be "
        "carried out, for a reason that is itself a finding: there is no single set of forms or "
        "records to analyse, because the process is spread across email, spreadsheets and "
        "messaging applications, which is the fragmentation stated as a problem in Section "
        "1.2.2.1. The survey was therefore selected as the only method that could reach a group "
        "large enough for its answers to be read as a pattern, within the time available and "
        "without asking participants to identify themselves. Its known weakness is that a fixed "
        "set of questions cannot capture what the person writing them did not think to ask, which "
        "is why the open-ended question described in Section 3.7.4 was included, and why the "
        "survey results were treated as the starting point for the requirements rather than as the "
        "whole of them, with the remainder refined through prototyping and supervisor feedback "
        "during development.",
    ]),

    # ---- 3.9 summary -------------------------------------------------------
    ("Based on this comparison and supporting literature, a Waterfall", "replace", [
        "Based on this comparison and supporting literature, a Waterfall–Agile Hybrid with "
        "evolutionary prototyping was selected as the most suitable methodology. This approach "
        "combines structured planning for system architecture with iterative development and "
        "continuous feedback through prototyping tools. It ensures both stability in core system "
        "design and adaptability in user-facing features. The three pure alternatives were "
        "rejected on grounds specific to this project rather than on general preference: Waterfall "
        "because the departmental requirements were not settled before design began, Scrum because "
        "its coordination mechanisms address problems that do not arise for a single developer, "
        "and RAD because it defers the architectural decisions this system cannot afford to revise "
        "late. What each contributes was kept, and Section 3.5 states which part of the process "
        "each of them governs.",
    ]),

    # ---- 5.2 test plan -----------------------------------------------------
    ("Testing was performed continuously rather than as a phase at the end", "after", [
        "Two other approaches to verification were available and were not adopted. Automated "
        "end-to-end testing through a driven browser, using a tool such as Selenium or Cypress, "
        "would have exercised the same rules through the interface a user actually sees; it was "
        "rejected because tests of that kind are bound to the structure of the pages they drive, "
        "and this interface was still changing, so the effort would have gone into repairing tests "
        "rather than extending coverage, while each rule would have been proved more slowly "
        "through a longer path than the one that reaches it directly. A period of live use by real "
        "staff would have produced the strongest evidence of all and was not available, because "
        "running the platform against real event data requires an institutional authorisation this "
        "project does not hold. The two techniques adopted answer the two questions that remain: "
        "the unit scenarios establish that each rule holds when the system is driven directly, and "
        "the acceptance sessions establish that people holding the roles those rules are written "
        "for can complete their work without being told how.",
    ]),
]
