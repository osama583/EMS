# FYP Demonstration Video — Recording Script

**Project** Developing a Centralized Role Based Event Coordination Platform for
Multi Departments University Workflow Management (APU EMS)
**Author** Osamah Ahmed Mohammed Al-Naggar · TP078781 · APD3F2601CS
**Supervisor** Mr. Mustafa Othman · 2nd Marker: Ms. Aida Raihanah
**Audience** Internal and external moderators
**Target length** 4 minutes 45 seconds (the brief allows 3–5)
**Export file name** `Osamah Ahmed Mohammed Al-Naggar-TP078781-APD3F2601CS-Video.mp4`

The programme is B.Sc. (Hons) Computer Science, not CSDA, so the brief's
data-import / preprocessing / model-building / evaluation / deployment sequence
does not apply. This script demonstrates the software end product instead: the
proposal workflow, its authorisation model, the fulfilment chain, the dashboards,
the AI assistant and the administration area.

---

## 1. Before you press record

Both servers up, seeded, and left running for the whole take:

```powershell
cd backend;  .venv/Scripts/python wsgi.py          # http://localhost:5000
cd fyp-ui;   npm start                             # http://localhost:4200
```

Run `.venv/Scripts/python -m seed.run --reset` if the data needs rebuilding; it
prints the demo password once, and `DEMO_PASSWORD` in `backend/.env` is what every
account below signs in with.

**Stage one browser window per account, each in its own Chrome profile, with tabs
opened and loaded in advance.** Page loads on camera cost you 30 to 40 seconds you
do not have. Alt-Tab between windows; never sign out and back in on camera.

| Window | Account | Tabs to open in advance |
|---|---|---|
| W1 Guest | signed out | `/` |
| W2 Student | `applicant@demo.apu.edu.my` | `/app/forms/event-proposal` (filled as far as step 3), `/app/created-by-me` |
| W3 Reviewer | `hoshod@demo.apu.edu.my` | `/app/inbox/proposals`, one proposal open at `/app/proposals/review/<id>` |
| W4 Department | `logistics.manager@demo.apu.edu.my` | `/app/proposals/review/<id>`, `/app/dashboard` |
| W5 Staff | `logistics.staff@demo.apu.edu.my` | `/app/inbox/tasks` with the date range widened so rows show |
| W6 Cafeteria | `cafeteria.staff2@demo.apu.edu.my` | `/app/inbox/cafeteria-tasks` |
| W7 Attendee | `j.tanaka@example.com` | `/`, `/my-events/pending` |
| W8 CFO | `cfo@demo.apu.edu.my` | `/app/dashboard` |
| W9 Admin | `system.admin@demo.apu.edu.my` | `/app/admin/page-visibility`, `/app/admin/settings/policies`, `/app/admin/ai-access-log` |

Also do this first:

- Set the display to 1920×1080 and the browser to 100% zoom. Hide the bookmarks bar,
  extensions, notifications, and anything carrying your personal name or mail.
- Suppress the development demo-account picker on the login screen if it appears.
- Pin the sidebar open in every internal window so the menu labels are readable.
- Pick one proposal and follow it the whole way through. It needs high pax so the
  CFO gate fires, and a logistics requirement so the department fan-out has
  something to show.
- Have the AI assistant question typed into a scratch file, ready to paste.

**Do not film these.** They are documented live defects, and a moderator who spots
one takes away a worse impression than one who never sees it. Re-check them before
recording, since several were fixed after the report screenshots were captured: the
public event-details modal (renders empty when the events list omits `clubs`),
`/app/inbox/registrations` and `/app/ongoing/events` (both genuinely empty, because
no registration anywhere is in `pending`), and the My Events result count reading
zero above a populated grid.

---

## 2. The script

Timecodes are cumulative. The narration is written to roughly 150 words a minute;
read it at that pace and the take lands at 4:45.

### 00 · Title — 0:00 to 0:15

**Screen** A static title card carrying the project title, your name, TP078781,
APD3F2601CS, supervisor and second marker. No animation.

> Good afternoon. I am Osamah Ahmed Mohammed Al-Naggar, TP078781. This is a
> demonstration of a centralised, role-based event coordination platform for
> university workflow management, built as an Angular client over a Flask API on
> Supabase PostgreSQL. I will follow one event proposal from draft through to a
> published, fulfilled event.

### 01 · Public entry and discovery — 0:15 to 0:40

**Screen** W1, signed out, on `/`. Scroll from the hero into Happening Soon, then
into the Explore grid. Type one word into the search field so the result count
moves. Do not open an event card.

> The public side needs no account. Visitors browse published events, filter and
> search them, save what interests them, and register. Everything on this page is a
> proposal that has already cleared its full approval chain. Nothing reaches it
> without one. That chain is what the rest of this video is about.

### 02 · Proposal creation — 0:40 to 1:25

**Screen** W2. Open on step 3 of the six-step form, already filled. Tick logistics
and food and beverage in the requirement picker. Move to step 4 to show the detail
tables. Jump to step 6, the final review. Press Next with a required field cleared
so the inline validation surfaces, fix it, then submit.

> A staff member or student raises the proposal through a six-step form. Step three
> is the important one: the applicant picks which departments they need, and that
> selection is what routes the proposal later. No routing is chosen by hand. Step
> four collects the detail behind each requirement, so items, quantities, dates and
> locations. Step six reads the whole proposal back before submission. Validation
> runs on every step change and blocks submission with the invalid step named, and
> the same rules are enforced again on the server, because the client is never the
> authority on anything. Submitting writes the request and its first workflow
> history row inside a single transaction.

### 03 · Review, decision and routing — 1:25 to 2:00

**Screen** W3, the Head of School inbox with its pending count, then the open
proposal. Show the KPI strip and the Workflow Actions panel. Press "Reject proposal"
with the comment box empty so the required-reason error appears. Clear that, then
approve.

> The proposal lands in the Head of School's inbox, scoped in SQL to what this role
> may see. The review page summarises it, and the actions panel offers approve, send
> back for changes, or reject. A rejection without a written reason is refused.
> Approval here publishes nothing. Because this proposal is over the pax threshold
> and asks for catering, it routes onward to Food and Beverage and to the CFO before
> the operational departments see it at all. The stage machine decides that on the
> server, from the requirements the applicant selected.

### 04 · Department fulfilment — 2:00 to 2:30

**Screen** W4, the same proposal seen as the Logistics head. Point at the heading
that scopes it to "Your Department's Requested Items". Open "Confirm department
fulfilment", pick an assignee, confirm. Cut to W5 and show the task now sitting in
the staff inbox.

> This is the same review page seen by a department head, and it shows only that
> department's own requested items. Confirming fulfilment is where assignment
> happens, and approval stays disabled until a team member is named. The moment it
> is confirmed the task appears in that staff member's inbox with its setup schedule
> and location. An approved proposal fans out into one task per responsible
> department, and every one of them is tracked through to completion.

### 05 · Cafeteria shared pool — 2:30 to 2:50

**Screen** W6, `/app/inbox/cafeteria-tasks` in card view. Claim one order.

> Catering works differently, because a cafeteria is a team rather than one named
> owner. Orders for the outlet sit in a shared pool, and any staff member at that
> outlet claims the one they will prepare. Same workflow engine, different
> assignment rule.

### 06 · Publication and registration — 2:50 to 3:15

**Screen** W7 as the external attendee, on `/`. Find the now-published event, open
registration, submit. Cut to `/my-events/pending`.

> Once every stage has cleared, the proposal becomes a published event and appears
> on the public page. An attendee registers here. Where the organiser chose manual
> approval, the registration waits in My Events as pending until they decide; where
> they chose automatic, it confirms straight away. That choice was made on the
> proposal form, back at step two.

### 07 · Dashboards — 3:15 to 3:40

**Screen** W8, the CFO dashboard. Change the period selector so the figures move.
Cut to `/app/dashboard` in W4 for the Logistics head and its workload bar chart.

> Six roles have their own dashboard. The CFO sees commitment and coverage: total
> spend, the cafeteria share of it, cost per pax, and how long each approval gate
> holds a proposal. The Logistics head sees jobs at risk, on-time completion, and
> who is carrying how much work. Both are the same component. Each role's widgets
> come from a profile the server issues, so adding a role is a server entry rather
> than a code change, and every metric is scoped to what that role may see.

### 08 · AI assistant — 3:40 to 4:10

**Screen** W4, open the assistant from the orb in the corner. Paste a question this
role may legitimately ask, such as "how many logistics tasks are still open this
month?". Show the answer. Cut to W9 and `/app/admin/ai-access-log`, on a denied row.

> The assistant answers questions in natural language, over the data the asker is
> allowed to see. The question is classified to a topic, the topic is checked
> against the pages this user has been granted, a scoped query is generated, and
> every generated statement passes a guard before it is allowed to run. Ask
> something outside your scope and it is refused rather than quietly answered.
> Administrators see the whole log: who asked, the topic, the outcome, and the
> reason behind each denial.

### 09 · Administration — 4:10 to 4:32

**Screen** W9. Page Visibility first: grant a page to a role and say what that does.
Then `/app/admin/settings/policies`, on the pax threshold.

> Navigation here is configuration rather than code. Granting a page to a role and
> unit makes it appear in that role's sidebar, and the menu is rendered entirely
> from server-issued grants. The approval policy screen is the other half of it. The
> thresholds that decided this proposal needed a CFO signature are editable on this
> page, so the routing rules can change without a deployment.

### 10 · Close — 4:32 to 4:45

**Screen** Back to the title card, or the ERD at `digrams/png/00-erd.png`.

> That is the journey end to end: draft, routed approval, department fulfilment,
> publication and registration, over a schema of sixty-eight tables, with every
> authorisation decision taken on the server and written to an audit trail. Thank
> you for watching.

---

## 3. Recording and export

Teams satisfies the brief, but it records at a fixed bitrate and gives you no
control over the resulting file. **OBS Studio is the better choice** and keeps the
file well under the 1000 MB cap. Settings:

- Output 1920×1080 at 30 fps, x264, CRF 23, `veryfast` preset, MP4 container.
- Audio: your microphone only, 128 kbps AAC. Mute desktop audio; the app makes none.
- Expect 150 to 250 MB for five minutes, so about a quarter of the cap.

Record the eleven segments separately rather than in one continuous take. A fluffed
line then costs you one segment instead of the whole video. Save them into
`docs/demo-video/segments/` as `00-title.mp4`, `01-public.mp4` and so on in running
order, then:

```powershell
pwsh -File docs/demo-video/build-video.ps1
```

That concatenates them in filename order, reports the duration and the file size,
re-encodes only if the result exceeds 1000 MB, and writes the correctly named file
to your Desktop. It fails loudly if the total runs outside 3 to 5 minutes.

If you would rather record in Teams: start a meeting with yourself, share the full
screen rather than a single window, since window share drops frames on tab
switches. Record, download the MP4 from OneDrive, then run the same build script
over that one file to check its duration and size and to give it the required name.
