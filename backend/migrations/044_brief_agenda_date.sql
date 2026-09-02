-- ============================================================================
-- Migration 044 - brief_agenda.agenda_date.
--
-- A multi-day event's agenda rows carry the day they belong to: the proposal
-- form adds a required Date column as soon as the schedule spans more than one
-- date (agendaColumns() in event-proposal.ts). That value had nowhere to land -
-- brief_agenda only stored the time - so it was dropped on save and every
-- reopened draft showed the agenda's Date column as "-".
--
-- Nullable, because single-day events legitimately have no per-row date and
-- every agenda row written before this migration has none to backfill.
-- ============================================================================

ALTER TABLE brief_agenda ADD COLUMN IF NOT EXISTS agenda_date DATE;
