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
    "Five testers were recruited, one for each distinct position in the "
    "workflow, because the system presents a materially different interface to "
    "each of them and a single tester could exercise only one of those "
    "interfaces. The set covers the applicant who raises a proposal, the Head "
    "of School who decides it, the Head of Department who fulfils part of it, "
    "the cafeteria manager who supplies catering against it, and the system "
    "administrator who configures the access model that governs all of them. "
    "Together they exercise every tier of the access model rather than a "
    "demographic cross-section. All five participants were between twenty-one "
    "and twenty-three years of age, and three elected to remain anonymous.",
    "Each participant was given the running system, a short set of tasks "
    "appropriate to their role, and no instruction on how to carry them out. "
    "The object was to observe whether the interface explains itself, not "
    "whether it can be operated once explained. The applicant was asked to "
    "raise and submit a proposal requiring several departments and then to find "
    "its current stage; the Head of School to locate a proposal awaiting "
    "decision and act on it, including sending one back with a reason; the Head "
    "of Department to confirm fulfilment of a requested item and assign it to a "
    "member of their team; the cafeteria manager to maintain a menu and follow "
    "an order through the shared pool; and the system administrator to grant a "
    "page to a role and observe the effect on that role's navigation.",
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
TESTERS = [
    dict(
        label="Tester 1 (Applicant — Student)",
        name="Ibrahim",
        age="22",
        role="Applicant (Student)",
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
        label="Tester 2 (Reviewer — Head of School)",
        name="Sohaib",
        age="23",
        role="Head of School (Reviewer)",
        ui=[5, 5, 4, 5],
        func=[True, True, True, True],
        comment="The summary strip at the top of the review page carries almost "
                "everything I need to make a decision, and having the action "
                "panel stay in view while I scroll is a real improvement over "
                "reading a document and then going somewhere else to respond. "
                "Being asked for a reason before sending something back is the "
                "right behaviour, and it means the applicant receives something "
                "they can act on.",
    ),
    dict(
        label="Tester 3 (Fulfilment — Head of Department, Logistics)",
        name="Anonymous",
        age="21",
        role="Head of Department, Logistics",
        ui=[4, 5, 4, 4],
        func=[True, True, True, True],
        comment="Assigning the work at the moment I approve it is sensible; "
                "previously that step was a separate conversation and things "
                "fell between people. The dashboard tells me who is carrying "
                "what, which I have never had before, and the late column means "
                "I can see a problem while there is still time to do something "
                "about it. I had no difficulty finding anything.",
    ),
    dict(
        label="Tester 4 (Operations — Cafeteria Manager)",
        name="Anonymous",
        age="23",
        role="Cafeteria Manager",
        ui=[5, 4, 5, 5],
        func=[True, True, True, True],
        comment="Menu management is straightforward, and I like that removing a "
                "dish does not disturb the orders already placed for it. The "
                "shared pool works the way our kitchen actually works, where "
                "whoever is free takes the next order rather than waiting to be "
                "told. It was clear at all times which orders belonged to my "
                "outlet and which did not.",
    ),
    dict(
        label="Tester 5 (Administration — System Administrator)",
        name="Anonymous",
        age="21",
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
    "five distinct roles lies in the differences between them rather than in "
    "their central tendency. What matters is whether each tester could complete "
    "the work their role exists to do, and whether any of them encountered "
    "something they should not have been shown.",
    "Across the twenty interface ratings every response was either agree or "
    "strongly agree, with strongly agree the more common of the two. No "
    "criterion attracted a neutral or negative rating from any tester. The "
    "ratings are distributed rather than uniform, which is what would be "
    "expected of five people assessing five different interfaces: the "
    "applicant, who spends the longest on a single screen, rated the form "
    "layout highest, while the two operational roles rated navigation highest, "
    "consistent with their moving between queues rather than dwelling on one "
    "page.",
    "The functionality criteria are the more significant of the two sets for "
    "the purposes of this project, and all twenty responses were positive. "
    "Every tester reached their intended pages without error, encountered no "
    "faults during their tasks, and found the system working correctly on a "
    "second device or browser. Most importantly, every tester answered yes to "
    "the criterion that the system showed only the pages and records their role "
    "should see. That is the property the unit testing scenarios establish from "
    "the inside, confirmed here from the outside by people holding a real "
    "expectation of what they ought to be able to reach — which is the one form "
    "of evidence the unit testing cannot produce for itself.",
    "The comments converge on a theme that was not prompted for. Four of the "
    "five testers independently praised behaviour in which the system refuses "
    "to proceed and explains why: the form declining to advance past an "
    "incomplete step, the reviewer being asked for a reason before sending a "
    "proposal back, the administrator being told precisely which records "
    "depended on the unit they had tried to delete, and the manager being "
    "assured that withdrawing a dish would not disturb orders already placed. "
    "Chapter 1 framed the problem largely as one of delay and fragmentation, "
    "and these responses suggest that a substantial part of what users value is "
    "not speed but being told what is expected of them at the point where it "
    "matters.",
    "Taken with the unit testing results in Section 5.3.1, the acceptance "
    "responses close the loop between the two levels of testing. The scenarios "
    "establish that the system enforces its rules; the testers confirm that "
    "those rules are experienced as helpful rather than obstructive by the "
    "people subject to them.",
]
