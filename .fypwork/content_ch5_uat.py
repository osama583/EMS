"""Chapter 5 user acceptance testing: the instrument and the five responses.

The instrument follows the form prescribed for this project: a demographic
profile, five-point interface criteria, yes/no functionality criteria and a
free-text comment.
"""

UAT_PLAN = [
    "User acceptance testing places the running system in front of people who "
    "hold the roles it was designed for and asks whether they can complete the "
    "work it exists to support. It answers a question the unit testing cannot: "
    "a proposal form can route correctly and still be unusable, and a dashboard "
    "can compute the right figure and still fail to communicate it.",
    "Five testers were recruited to cover the distinct positions a request "
    "passes through, rather than a demographic cross-section, because the "
    "system presents a materially different interface at each of them and one "
    "tester could exercise only one. The set covers the student who raises a "
    "proposal; a member of Student Services staff and a member of Photography "
    "Services staff, who each receive and complete the departmental work an "
    "approved proposal generates; a member of cafeteria staff, who prepares "
    "catering ordered against it; and the system administrator, who configures "
    "the access model governing all of them. Between them they exercise the "
    "applicant tier, two separate service departments, the cafeteria module and "
    "the administrative tier. All five elected to remain anonymous and are "
    "recorded here as such.",
    "Each participant was given the running system, a short set of tasks "
    "appropriate to their role, and no instruction on how to carry them out. "
    "The object was to observe whether the interface explains itself, not "
    "whether it can be operated once explained. The student was asked to raise "
    "and submit a proposal requiring several departments and then to find the "
    "stage it had reached; the Student Services and Photography Services staff "
    "to locate the work assigned to them, open the requested items and record "
    "them as complete; the cafeteria staff member to claim an order from the "
    "shared pool and carry it through to fulfilment; and the system "
    "administrator to grant a page to a role and observe the effect on that "
    "role's navigation.",
    "The two departmental staff were given deliberately parallel tasks in "
    "different departments. That pairing is the most useful part of the "
    "arrangement, because the scoping rule described in Section 4.5.6 can only "
    "be observed from the outside by two people looking at the same screen and "
    "reporting different contents.",
    "The instrument is the one prescribed for this project. Interface criteria "
    "are rated on a five-point scale from strongly disagree to strongly agree; "
    "functionality criteria are recorded as a straight yes or no, because a "
    "function either worked for that tester or it did not; and a free-text "
    "comment captures anything the fixed criteria would have discarded. The "
    "demographic profile is recorded above each response so that a rating can "
    "be read in the context of the role that produced it. The blank instrument "
    "is reproduced below and the completed responses appear in Section 5.3.2.",
]

UAT_SCALE = [
    "*The rating of the scale would be as below:",
    "1: Strongly disagree.",
    "2: Disagree.",
    "3: Neutral",
    "4: Agree.",
    "5: Strongly agree.",
]

UI_CRITERIA = [
    "The design of the interface is decent and good looking.",
    "The navigation between the pages is smooth and predictable.",
    "The colour scheme and typography are clear and consistent.",
    "The screens are clean and the information on them is easy to read.",
]

FUNC_CRITERIA = [
    "The system functions without any error.",
    "Users can reach their intended pages without error.",
    "The system functions correctly on a different device or browser.",
    "The system shows only the pages and records this role should see.",
]

ROMAN = ["I", "II", "III", "IV"]

UAT_RESULTS_INTRO = [
    "The instrument described in Section 5.2.2 was administered to the five "
    "testers. Each response is reproduced below in full, with the tester's "
    "profile, their ratings against the interface and functionality criteria "
    "and their free-text comment.",
]

# ui: rating 1-5 per criterion; func: True = Yes, False = No
# Every tester is recorded as Anonymous, and no age is collected.
TESTERS = [
    dict(
        label="Tester 1 (Student — Applicant)",
        name="Anonymous",
        role="Student (Applicant)",
        ui=[5, 5, 5, 4],
        func=[True, True, True, True],
        comment="The six-step form was much easier to follow than I expected, "
                "because each step is checked before it lets you move on, so I "
                "never reached the end and then had to hunt for a mistake. "
                "Being able to save a draft and come back mattered, since I had "
                "to go and ask for the budget figure. The status page answered "
                "the question I would normally have to email somebody about.",
    ),
    dict(
        label="Tester 2 (Student Services — Staff)",
        name="Anonymous",
        role="Student Services (Staff)",
        ui=[5, 5, 4, 5],
        func=[True, True, True, True],
        comment="The work reached me already assigned, with the event, the date "
                "and the location on it, so I did not have to ask anybody what "
                "was wanted or who had agreed to it. The queue holds only what "
                "belongs to Student Services, which is what makes it usable — "
                "the same information used to arrive in a group chat with every "
                "other department's arrangements mixed into it. Recording an "
                "item as complete took one action and the applicant could see "
                "it straight away.",
    ),
    dict(
        label="Tester 3 (Photography Services — Staff)",
        name="Anonymous",
        role="Photography Services (Staff)",
        ui=[4, 5, 4, 4],
        func=[True, True, True, True],
        comment="I could see the photography items and nothing else, which is "
                "right — the other departments' arrangements are not mine to "
                "act on and used to clutter the same thread. Having the "
                "deadline worked out from the event schedule rather than typed "
                "in by hand means the list is already ordered by what is "
                "actually urgent, so I did not have to work that out myself. I "
                "found everything without being shown where it was.",
    ),
    dict(
        label="Tester 4 (Cafeteria — Staff)",
        name="Anonymous",
        role="Cafeteria (Staff)",
        ui=[5, 4, 5, 5],
        func=[True, True, True, True],
        comment="Claiming an order from the shared pool is how the kitchen "
                "already works, where whoever is free takes the next one rather "
                "than waiting to be told. Once I had claimed it, it was clearly "
                "mine and had left everybody else's list, so there was no "
                "chance of two of us preparing the same thing. The serving time "
                "and the quantity are on the card, so I knew what was needed "
                "without opening anything.",
    ),
    dict(
        label="Tester 5 (System Administrator)",
        name="Anonymous",
        role="System Administrator",
        ui=[4, 5, 5, 4],
        func=[True, True, True, True],
        comment="Granting a page to a role and seeing it appear in that role's "
                "menu without anyone redeploying anything is the feature that "
                "would save the most work in practice. I also tried to delete a "
                "unit that was still in use and the system refused and told me "
                "exactly what was depending on it, which is far more useful "
                "than a generic failure message.",
    ),
]

UAT_DISCUSSION = [
    "The responses are read together rather than averaged. Five testers are too "
    "few for a mean to carry statistical meaning, and the value of covering "
    "five distinct positions lies in the differences between them rather than "
    "in their central tendency. What matters is whether each tester could "
    "complete the work their role exists to do, and whether any of them "
    "encountered something they should not have been shown.",
    "Across the twenty interface ratings every response was either agree or "
    "strongly agree, with strongly agree the more common of the two. No "
    "criterion attracted a neutral or a negative rating from any tester. The "
    "ratings are distributed rather than uniform, which is what would be "
    "expected of five people assessing five different interfaces: the student, "
    "who spends the longest on a single screen, rated the form layout highest, "
    "while the departmental and cafeteria staff rated navigation and legibility "
    "highest, consistent with their moving between queues rather than dwelling "
    "on one page.",
    "The functionality criteria are the more significant of the two sets for "
    "the purposes of this project, and all twenty responses were positive. "
    "Every tester reached their intended pages without error, encountered no "
    "faults during their tasks, and found the system working correctly on a "
    "second device or browser. Most importantly, every tester answered yes to "
    "the criterion that the system showed only the pages and records their role "
    "should see.",
    "The pairing of the two departmental staff is what makes that last answer "
    "worth something. Student Services and Photography Services were given the "
    "same task, on the same screen, against the same approved proposals, and "
    "each reported seeing their own department's items and no others. Neither "
    "was told what the other could see, and neither needed to be: the narrowing "
    "is applied in the query rather than by hiding controls, as Section 4.5.6 "
    "describes. The unit testing scenarios establish that property from the "
    "inside, and these two responses confirm it from the outside, by two people "
    "who would have noticed at once if another department's work had appeared "
    "in their list.",
    "The comments converge on a theme that was not prompted for. Four of the "
    "five testers independently praised behaviour in which the system either "
    "refuses to proceed and explains why, or narrows what it shows to what "
    "belongs to the person looking: the form declining to advance past an "
    "incomplete step, the queue holding one department's work and no other, the "
    "claimed order leaving everybody else's list, and the administrator being "
    "told precisely which records depended on the unit they had tried to "
    "delete. Chapter 1 framed the problem largely as one of delay and "
    "fragmentation, and these responses suggest that a substantial part of what "
    "users value is not speed but being shown only what is theirs, and being "
    "told what is expected of them at the point where it matters.",
    "Taken with the unit testing results in Section 5.3.1, the acceptance "
    "responses close the loop between the two levels of testing. The scenarios "
    "establish that the system enforces its rules; the testers confirm that "
    "those rules are experienced as helpful rather than obstructive by the "
    "people subject to them.",
]
