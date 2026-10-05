-- Independence determinations as spans, and staging for other-board disclosures.

-- Boards determine independence at points in time (each proxy). We store the span a
-- determination is taken to cover, at medium confidence unless a filing dates it.
CREATE TABLE board_independence (
  id               bigserial PRIMARY KEY,
  membership_id    bigint NOT NULL REFERENCES board_membership ON DELETE CASCADE,
  is_independent   boolean NOT NULL,
  start_date       date,
  start_precision  text NOT NULL CHECK (start_precision IN ('day', 'month', 'year', 'unknown')),
  end_date         date,
  end_precision    text CHECK (end_precision IN ('day', 'month', 'year', 'unknown')),
  confidence       text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_precision = 'unknown') = (start_date IS NULL))
);
CREATE INDEX board_independence_membership ON board_independence (membership_id);

CREATE TRIGGER board_independence_audit AFTER INSERT OR UPDATE OR DELETE ON board_independence
  FOR EACH ROW EXECUTE FUNCTION bt_audit();

ALTER TABLE evidence_link DROP CONSTRAINT evidence_link_subject_type_check;
ALTER TABLE evidence_link ADD CONSTRAINT evidence_link_subject_type_check
  CHECK (subject_type IN ('company', 'person', 'board_membership', 'board_role', 'board_event', 'board_snapshot',
                          'corporate_action', 'person_affiliation', 'board_independence', 'extracted_fact'));

-- Other public-company boards named in a proxy biography. Staged (not canonical) until
-- the other company is tracked and its own filings confirm the seat.
ALTER TABLE extracted_fact DROP CONSTRAINT extracted_fact_fact_type_check;
ALTER TABLE extracted_fact ADD CONSTRAINT extracted_fact_fact_type_check
  CHECK (fact_type IN ('director_appointed', 'director_departed', 'role_assigned', 'role_ended', 'roster_member',
                       'insider_relationship', 'board_size', 'other_board_disclosed'));

-- Natural keys used by idempotent loaders.
CREATE UNIQUE INDEX board_membership_natural ON board_membership (company_id, person_id, coalesce(start_date, '0001-01-01'));
CREATE UNIQUE INDEX board_role_natural ON board_role (membership_id, role, coalesce(start_date, '0001-01-01'));
CREATE UNIQUE INDEX evidence_natural ON evidence (source_document_id, md5(coalesce(quote, '')), coalesce(locator, ''));

-- What an excerpt establishes, in words ("Risher appointed effective 2021-07-09").
ALTER TABLE evidence ADD COLUMN note text;
