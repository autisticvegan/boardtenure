-- A base year that was the CEO's first full year after a change (sign-on awards often land in the
-- change year, leaving the first full year unusually low). Kept in the statistics; named lists skip it.
ALTER TABLE pay_change ADD COLUMN new_ceo_base boolean NOT NULL DEFAULT false;
