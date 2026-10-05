-- BoardTenure canonical schema.
-- Forward-only migrations; applied in filename order by `bt db migrate`.
-- Targets PostgreSQL 13+ (local dev runs 13; production should run 16+).
-- Enumerations are text + CHECK rather than PG enums so they can evolve without type rewrites.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Search/identity normalization: accent-fold, lowercase, collapse punctuation.
-- The two-argument unaccent with an explicit dictionary is immutable in practice,
-- which lets this be used in generated columns and indexes.
CREATE FUNCTION bt_normalize(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(t, ''))),
                              '[^a-z0-9]+', ' ', 'g'))
$$;

-- A partially known date is stored as the first day of its window plus a precision.
-- These return the inclusive bounds of that window (NULL when unknown).
CREATE FUNCTION bt_window_start(d date, prec text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN prec IN ('day', 'month', 'year') THEN d END
$$;

CREATE FUNCTION bt_window_end(d date, prec text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE prec
    WHEN 'day'   THEN d
    WHEN 'month' THEN (d + interval '1 month' - interval '1 day')::date
    WHEN 'year'  THEN (d + interval '1 year'  - interval '1 day')::date
  END
$$;

CREATE FUNCTION bt_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Issuers and listed securities
-- ---------------------------------------------------------------------------

CREATE TABLE company (
  id                      bigserial PRIMARY KEY,
  slug                    text NOT NULL UNIQUE,          -- URL key; normally the lowercase primary ticker
  cik                     text UNIQUE CHECK (cik ~ '^[0-9]{10}$'),
  legal_name              text NOT NULL,
  common_name             text NOT NULL,
  country                 char(2),                       -- ISO 3166-1 alpha-2, headquarters
  state_of_incorporation  text,
  sic_code                text,
  sector                  text,
  industry                text,
  website                 text,
  status                  text NOT NULL DEFAULT 'public'
                            CHECK (status IN ('public', 'delisted', 'acquired', 'private', 'bankrupt')),
  ipo_date                date,                          -- first trade date of the primary security
  delisted_date           date,
  fiscal_year_end         char(4),                       -- MMDD, as reported to the SEC
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_name_trgm ON company USING gin (bt_normalize(common_name) gin_trgm_ops);

-- A company can have several listings (share classes, ADRs); ETFs and indexes have no company.
CREATE TABLE security (
  id                bigserial PRIMARY KEY,
  company_id        bigint REFERENCES company,
  kind              text NOT NULL CHECK (kind IN ('common_stock', 'adr', 'etf', 'index')),
  symbol            text NOT NULL,                     -- current (or last) trading symbol
  exchange          text,                              -- ISO 10383 MIC, e.g. XNAS, XNYS, ARCX
  share_class       text,
  name              text NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'USD',
  is_primary        boolean NOT NULL DEFAULT false,    -- the listing used for company returns
  first_trade_date  date,
  last_trade_date   date,
  figi              text UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('etf', 'index') OR company_id IS NOT NULL)
);
CREATE UNIQUE INDEX security_one_primary ON security (company_id) WHERE is_primary;
CREATE INDEX security_symbol_idx ON security (upper(symbol));

-- Symbol history so ticker changes (FB -> META) resolve and old URLs can redirect.
CREATE TABLE security_symbol (
  security_id  bigint NOT NULL REFERENCES security ON DELETE CASCADE,
  symbol       text NOT NULL,
  exchange     text,
  valid_from   date NOT NULL,
  valid_to     date,                                    -- exclusive; NULL = still valid
  PRIMARY KEY (security_id, valid_from)
);
CREATE INDEX security_symbol_lookup ON security_symbol (upper(symbol));

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

CREATE TABLE source (
  id                  smallserial PRIMARY KEY,
  code                text NOT NULL UNIQUE,             -- 'sec_edgar', 'stooq', 'manual_research', ...
  name                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('regulatory_filing', 'market_data', 'company_website',
                                                     'secondary', 'manual')),
  homepage_url        text,
  default_confidence  text NOT NULL CHECK (default_confidence IN ('high', 'medium', 'low')),
  license_notes       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- One retrieved artifact (a filing document, a price file, a web page). The raw bytes
-- live in the raw store (local dir or S3) at storage_uri, content-addressed by sha256.
CREATE TABLE source_document (
  id             bigserial PRIMARY KEY,
  source_id      smallint NOT NULL REFERENCES source,
  external_id    text NOT NULL,                         -- SEC: '<accession>/<filename>'
  doc_type       text NOT NULL,                         -- '8-K', 'DEF 14A', '3', '424B4', 'price_history', ...
  company_id     bigint REFERENCES company,
  title          text,
  url            text,
  published_at   date,                                  -- filing / publication date
  period_date    date,                                  -- report period or date of event
  retrieved_at   timestamptz NOT NULL,
  sha256         text,
  storage_uri    text,
  content_type   text,
  byte_size      integer,
  metadata       jsonb NOT NULL DEFAULT '{}',
  UNIQUE (source_id, external_id)
);
CREATE INDEX source_document_company ON source_document (company_id, published_at DESC);

-- Filing-level index of everything discovered on EDGAR for tracked issuers.
CREATE TABLE sec_filing (
  accession_number   text PRIMARY KEY CHECK (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  cik                text NOT NULL,                     -- issuer CIK the filing is about
  company_id         bigint REFERENCES company,
  form_type          text NOT NULL,
  filing_date        date NOT NULL,
  report_date        date,
  acceptance_at      timestamptz,
  items              text[] NOT NULL DEFAULT '{}',       -- 8-K items, e.g. {5.02,9.01}
  primary_document   text,
  processing_status  text NOT NULL DEFAULT 'pending'
                       CHECK (processing_status IN ('pending', 'skipped', 'processed', 'failed', 'needs_review')),
  processor_version  text,
  processed_at       timestamptz,
  error              text,
  discovered_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sec_filing_company ON sec_filing (company_id, filing_date DESC);
CREATE INDEX sec_filing_pending ON sec_filing (filing_date) WHERE processing_status = 'pending';

-- A specific supporting excerpt. quote_verified is set by machine-checking the quote
-- against the raw document; unverified evidence never raises a fact above 'low'.
CREATE TABLE evidence (
  id                  bigserial PRIMARY KEY,
  source_document_id  bigint NOT NULL REFERENCES source_document,
  quote               text,
  locator             text,                             -- section heading, XML path, char offset
  quote_verified      boolean,                          -- NULL = not yet checked
  quote_verified_at   timestamptz,
  extraction_method   text NOT NULL CHECK (extraction_method IN ('structured_xml', 'structured_json',
                                            'deterministic_text', 'llm', 'manual_research', 'manual_admin')),
  extractor           text,                             -- extractor name@version or LLM model id
  confidence          numeric(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  extracted_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_document ON evidence (source_document_id);

-- Which facts an evidence row supports (or contradicts). Polymorphic by design so any
-- canonical row and field can carry provenance without a link table per entity.
CREATE TABLE evidence_link (
  evidence_id   bigint NOT NULL REFERENCES evidence ON DELETE CASCADE,
  subject_type  text NOT NULL CHECK (subject_type IN ('company', 'person', 'board_membership', 'board_role',
                                       'board_event', 'board_snapshot', 'corporate_action', 'person_affiliation')),
  subject_id    bigint NOT NULL,
  field         text NOT NULL DEFAULT '*',              -- 'start_date', 'end_date', 'role', '*'
  stance        text NOT NULL DEFAULT 'supports' CHECK (stance IN ('supports', 'contradicts', 'context')),
  PRIMARY KEY (evidence_id, subject_type, subject_id, field)
);
CREATE INDEX evidence_link_subject ON evidence_link (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Prices and corporate actions
-- ---------------------------------------------------------------------------

-- Raw daily bars as delivered plus two forward-built indexes computed by the pipeline:
--   pr_index: price-return index (splits only)
--   tr_index: total-return index (splits + dividends reinvested on ex-date)
-- Both start at the first close and are append-only under new data, so daily updates
-- never rewrite history (unlike vendor back-adjusted closes).
CREATE TABLE price_daily (
  security_id         bigint NOT NULL REFERENCES security,
  trade_date          date NOT NULL,
  open                numeric(18, 6),
  high                numeric(18, 6),
  low                 numeric(18, 6),
  close               numeric(18, 6) NOT NULL CHECK (close > 0),
  volume              bigint,
  vendor_adj_close    numeric(20, 8),                   -- vendor's own adjusted close; cross-check only
  pr_index            double precision,
  tr_index            double precision,
  source_id           smallint NOT NULL REFERENCES source,
  source_document_id  bigint REFERENCES source_document,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (security_id, trade_date)
);

CREATE TABLE corporate_action (
  id                  bigserial PRIMARY KEY,
  security_id         bigint NOT NULL REFERENCES security,
  action_type         text NOT NULL CHECK (action_type IN ('split', 'cash_dividend', 'special_dividend',
                        'stock_dividend', 'spinoff', 'symbol_change', 'merger', 'acquisition', 'delisting',
                        'bankruptcy')),
  ex_date             date NOT NULL,
  record_date         date,
  pay_date            date,
  split_from          numeric(18, 8),                   -- 4-for-1 split: from=1, to=4
  split_to            numeric(18, 8),
  cash_amount         numeric(18, 8),                   -- per share, in post-action share units
  currency            char(3),
  details             jsonb NOT NULL DEFAULT '{}',
  source_id           smallint NOT NULL REFERENCES source,
  source_document_id  bigint REFERENCES source_document,
  confidence          text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (security_id, action_type, ex_date),
  CHECK (action_type <> 'split' OR (split_from > 0 AND split_to > 0)),
  CHECK (action_type NOT IN ('cash_dividend', 'special_dividend') OR cash_amount > 0)
);

-- Benchmarks are securities (ETF proxies by default; see docs/methodology.md).
CREATE TABLE benchmark (
  id           smallserial PRIMARY KEY,
  code         text NOT NULL UNIQUE,                    -- 'sp500', 'nasdaq_composite', 'russell2000'
  name         text NOT NULL,                           -- what users see: 'S&P 500 (SPY, total return)'
  security_id  bigint NOT NULL REFERENCES security,
  is_default   boolean NOT NULL DEFAULT false,
  proxy_note   text
);
CREATE UNIQUE INDEX benchmark_one_default ON benchmark (is_default) WHERE is_default;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE person (
  id                     bigserial PRIMARY KEY,
  slug                   text NOT NULL UNIQUE,          -- 'david-risher'; collisions get a numeric suffix
  full_name              text NOT NULL,
  normalized_name        text GENERATED ALWAYS AS (bt_normalize(full_name)) STORED,
  given_name             text,
  family_name            text,
  name_suffix            text,
  birth_year_min         smallint,                      -- from proxy-stated ages; used for disambiguation
  birth_year_max         smallint,
  biography              text,                          -- short neutral summary, sourced via evidence_link
  linkedin_url           text,
  merged_into_person_id  bigint REFERENCES person,      -- soft merge of duplicates; never hard-delete
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_person_id IS DISTINCT FROM id)
);
CREATE INDEX person_name_trgm ON person USING gin (normalized_name gin_trgm_ops);

CREATE TABLE person_alias (
  id                  bigserial PRIMARY KEY,
  person_id           bigint NOT NULL REFERENCES person ON DELETE CASCADE,
  alias               text NOT NULL,
  normalized_alias    text GENERATED ALWAYS AS (bt_normalize(alias)) STORED,
  alias_type          text NOT NULL CHECK (alias_type IN ('legal', 'nickname', 'sec_conformed', 'former', 'other')),
  source_document_id  bigint REFERENCES source_document,
  UNIQUE (person_id, normalized_alias)
);
CREATE INDEX person_alias_trgm ON person_alias USING gin (normalized_alias gin_trgm_ops);

-- Durable external IDs. The SEC reporting-owner CIK from Forms 3/4/5 is the strongest
-- available key for telling apart people with identical names.
CREATE TABLE person_identifier (
  scheme              text NOT NULL CHECK (scheme IN ('sec_cik', 'wikidata', 'linkedin')),
  value               text NOT NULL,
  person_id           bigint NOT NULL REFERENCES person ON DELETE CASCADE,
  source_document_id  bigint REFERENCES source_document,
  PRIMARY KEY (scheme, value)
);
CREATE INDEX person_identifier_person ON person_identifier (person_id);

-- Principal occupations ("CFO of Airbnb"), as disclosed in proxy biographies.
CREATE TABLE person_affiliation (
  id                 bigserial PRIMARY KEY,
  person_id          bigint NOT NULL REFERENCES person ON DELETE CASCADE,
  organization_name  text NOT NULL,
  company_id         bigint REFERENCES company,
  title              text,
  is_current         boolean NOT NULL,
  as_of_date         date NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_affiliation_person ON person_affiliation (person_id);

-- ---------------------------------------------------------------------------
-- Board membership
-- ---------------------------------------------------------------------------

-- One continuous board seat. A person who leaves and later rejoins has two rows.
-- start_date/end_date hold the first day of the known window; *_precision says how wide it is.
CREATE TABLE board_membership (
  id               bigserial PRIMARY KEY,
  company_id       bigint NOT NULL REFERENCES company,
  person_id        bigint NOT NULL REFERENCES person,
  seat_type        text NOT NULL DEFAULT 'director' CHECK (seat_type IN ('director', 'observer')),
  status           text NOT NULL CHECK (status IN ('current', 'former')),
  start_date       date,
  start_precision  text NOT NULL CHECK (start_precision IN ('day', 'month', 'year', 'unknown')),
  start_basis      text,                                -- e.g. '8-K: appointment effective date'
  end_date         date,
  end_precision    text CHECK (end_precision IN ('day', 'month', 'year', 'unknown')),
  end_basis        text,
  end_reason       text CHECK (end_reason IN ('resigned', 'did_not_stand', 'not_reelected', 'retired', 'died',
                                              'removed', 'term_expired', 'company_acquired', 'company_delisted',
                                              'other')),
  director_class   text,
  confidence       text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  review_status    text NOT NULL DEFAULT 'unreviewed'
                     CHECK (review_status IN ('unreviewed', 'auto_accepted', 'reviewed', 'disputed')),
  is_locked        boolean NOT NULL DEFAULT false,      -- admin-corrected: pipeline may propose, never overwrite
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_precision = 'unknown') = (start_date IS NULL)),
  CHECK (status = 'former' OR (end_date IS NULL AND end_precision IS NULL AND end_reason IS NULL)),
  CHECK (status = 'current' OR end_precision IS NOT NULL),
  CHECK (end_date IS NULL OR end_precision IS DISTINCT FROM 'unknown'),
  CHECK ((end_precision = 'unknown') IS NOT TRUE OR end_date IS NULL)
);
CREATE INDEX board_membership_company ON board_membership (company_id, status);
CREATE INDEX board_membership_person ON board_membership (person_id);

-- Leadership roles held during a membership. Independence is not a role: it is a
-- point-in-time determination and lives on board_snapshot_member.
CREATE TABLE board_role (
  id               bigserial PRIMARY KEY,
  membership_id    bigint NOT NULL REFERENCES board_membership ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('chair', 'executive_chair', 'vice_chair',
                                                 'lead_independent_director', 'executive_director')),
  officer_title    text,                                -- for executive_director: 'Chief Executive Officer'
  start_date       date,
  start_precision  text NOT NULL CHECK (start_precision IN ('day', 'month', 'year', 'unknown')),
  end_date         date,
  end_precision    text CHECK (end_precision IN ('day', 'month', 'year', 'unknown')),
  is_current       boolean NOT NULL,
  confidence       text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  review_status    text NOT NULL DEFAULT 'unreviewed'
                     CHECK (review_status IN ('unreviewed', 'auto_accepted', 'reviewed', 'disputed')),
  is_locked        boolean NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_precision = 'unknown') = (start_date IS NULL)),
  CHECK (NOT is_current OR end_date IS NULL)
);
CREATE INDEX board_role_membership ON board_role (membership_id);

-- A point-in-time roster as stated by one document (usually a proxy statement).
-- Used to cross-check memberships: everyone listed must hold a seat on as_of_date.
CREATE TABLE board_snapshot (
  id                  bigserial PRIMARY KEY,
  company_id          bigint NOT NULL REFERENCES company,
  as_of_date          date NOT NULL,
  snapshot_type       text NOT NULL CHECK (snapshot_type IN ('proxy', 'annual_report', 'prospectus',
                                                             'company_website', 'manual')),
  source_document_id  bigint NOT NULL REFERENCES source_document,
  board_size_stated   smallint,
  is_complete         boolean NOT NULL DEFAULT true,    -- false if the document lists only some directors
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_document_id)
);

CREATE TABLE board_snapshot_member (
  snapshot_id          bigint NOT NULL REFERENCES board_snapshot ON DELETE CASCADE,
  person_id            bigint NOT NULL REFERENCES person,
  membership_id        bigint REFERENCES board_membership,
  name_as_written      text NOT NULL,
  age                  smallint,
  director_since_text  text,
  director_class       text,
  is_independent       boolean,
  standing_for_election boolean,
  committees           jsonb NOT NULL DEFAULT '[]',     -- [{"committee": "audit", "role": "chair"}]
  roles                text[] NOT NULL DEFAULT '{}',
  evidence_id          bigint REFERENCES evidence,
  PRIMARY KEY (snapshot_id, person_id)
);

CREATE TABLE board_event (
  id                    bigserial PRIMARY KEY,
  company_id            bigint NOT NULL REFERENCES company,
  person_id             bigint REFERENCES person,
  membership_id         bigint REFERENCES board_membership ON DELETE SET NULL,
  event_type            text NOT NULL CHECK (event_type IN ('BOARD_JOIN', 'BOARD_LEAVE', 'ROLE_CHANGE',
                                                            'BOARD_SIZE_CHANGE', 'COMMITTEE_CHANGE')),
  event_date            date,
  event_date_precision  text NOT NULL CHECK (event_date_precision IN ('day', 'month', 'year', 'unknown')),
  announced_date        date,
  details               jsonb NOT NULL DEFAULT '{}',
  confidence            text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  review_status         text NOT NULL DEFAULT 'unreviewed'
                          CHECK (review_status IN ('unreviewed', 'auto_accepted', 'reviewed', 'disputed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_event_company ON board_event (company_id, event_date DESC);

-- What we have actually reviewed, per company and period. Coverage is stated in terms
-- of sources processed, because the true number of historical directors is unknown.
CREATE TABLE coverage_period (
  id            bigserial PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES company,
  scope         text NOT NULL CHECK (scope IN ('current_board', 'board_history')),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  level         text NOT NULL CHECK (level IN ('complete', 'partial', 'minimal')),
  method        text NOT NULL,                          -- 'All DEF 14A and 8-K Item 5.02 filings reviewed'
  notes         text,
  assessed_at   timestamptz NOT NULL DEFAULT now(),
  assessed_by   text NOT NULL,
  CHECK (period_end >= period_start)
);

-- Staging layer: facts as extracted from a document, before entity resolution and
-- reconciliation into canonical tables. Nothing here is shown to users.
CREATE TABLE extracted_fact (
  id                    bigserial PRIMARY KEY,
  evidence_id           bigint NOT NULL REFERENCES evidence,
  company_id            bigint REFERENCES company,
  fact_type             text NOT NULL CHECK (fact_type IN ('director_appointed', 'director_departed',
                          'role_assigned', 'role_ended', 'roster_member', 'insider_relationship', 'board_size')),
  person_name           text,
  person_cik            text,
  payload               jsonb NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'applied', 'corroborating', 'rejected', 'needs_review')),
  resolved_person_id    bigint REFERENCES person,
  applied_subject_type  text,
  applied_subject_id    bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_at           timestamptz,
  reviewed_by           text
);
CREATE INDEX extracted_fact_status ON extracted_fact (status, company_id);

-- ---------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------

CREATE TABLE tenure_performance (
  membership_id           bigint NOT NULL REFERENCES board_membership ON DELETE CASCADE,
  benchmark_id            smallint NOT NULL REFERENCES benchmark,
  company_id              bigint NOT NULL REFERENCES company,
  person_id               bigint NOT NULL REFERENCES person,
  security_id             bigint REFERENCES security,
  status                  text NOT NULL CHECK (status IN ('ok', 'approximate', 'too_short',
                                                          'no_price_history', 'unknown_dates')),
  is_open                 boolean NOT NULL,
  start_anchor_date       date,
  start_anchor_reason     text CHECK (start_anchor_reason IN ('join_date', 'first_trade', 'join_window')),
  end_anchor_date         date,
  end_anchor_reason       text CHECK (end_anchor_reason IN ('leave_date', 'latest_close', 'last_trade',
                                                            'leave_window')),
  start_close             numeric(18, 6),               -- unadjusted closes, for display
  end_close               numeric(18, 6),
  calendar_days           integer,
  trading_days            integer,
  total_return            double precision,
  price_return            double precision,
  annualized_return       double precision,             -- NULL when the window is under one year
  bench_total_return      double precision,
  bench_annualized_return double precision,
  relative_return_pp      double precision,             -- total_return - bench_total_return
  excess_return           double precision,             -- (1 + r) / (1 + r_bench) - 1
  max_drawdown            double precision,
  mdd_peak_date           date,
  mdd_trough_date         date,
  return_low              double precision,             -- bounds when a date is only known to a window
  return_high             double precision,
  data_through            date,
  methodology_version     text NOT NULL,
  computed_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, benchmark_id)
);
CREATE INDEX tenure_performance_person ON tenure_performance (person_id);
CREATE INDEX tenure_performance_company ON tenure_performance (company_id);

-- ---------------------------------------------------------------------------
-- Operations: jobs, data quality, audit
-- ---------------------------------------------------------------------------

CREATE TABLE job_run (
  id           bigserial PRIMARY KEY,
  job_name     text NOT NULL,
  status       text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  params       jsonb NOT NULL DEFAULT '{}',
  stats        jsonb NOT NULL DEFAULT '{}',
  error        text
);
CREATE INDEX job_run_recent ON job_run (job_name, started_at DESC);

CREATE TABLE ingest_cursor (
  name        text PRIMARY KEY,                         -- 'sec_daily_index', 'prices:LYFT'
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Validation findings. fingerprint makes checks idempotent: re-running a check
-- refreshes last_seen_at instead of duplicating, and a check that stops firing resolves it.
CREATE TABLE data_issue (
  id               bigserial PRIMARY KEY,
  check_code       text NOT NULL,
  fingerprint      text NOT NULL UNIQUE,
  severity         text NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  priority         smallint NOT NULL CHECK (priority BETWEEN 1 AND 3), -- 1 current board, 2 recent, 3 older
  company_id       bigint REFERENCES company,
  person_id        bigint REFERENCES person,
  subject_type     text,
  subject_id       bigint,
  message          text NOT NULL,
  details          jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'acknowledged', 'resolved', 'wont_fix')),
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      text,
  resolution_note  text
);
CREATE INDEX data_issue_open ON data_issue (priority, severity) WHERE status IN ('open', 'acknowledged');

-- Row-level audit of canonical tables. Writers identify themselves with
--   SET LOCAL bt.actor = 'admin:alice' / 'pipeline:daily';  SET LOCAL bt.reason = '...';
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  reason       text,
  action       text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text NOT NULL,
  row_id       bigint,
  old_row      jsonb,
  new_row      jsonb
);
CREATE INDEX audit_log_row ON audit_log (table_name, row_id, occurred_at DESC);

CREATE FUNCTION bt_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_j jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  IF TG_OP = 'UPDATE' AND (old_j - 'updated_at') = (new_j - 'updated_at') THEN
    RETURN NEW;  -- no-op update
  END IF;
  INSERT INTO audit_log (actor, reason, action, table_name, row_id, old_row, new_row)
  VALUES (coalesce(nullif(current_setting('bt.actor', true), ''), 'db:' || session_user),
          nullif(current_setting('bt.reason', true), ''),
          TG_OP, TG_TABLE_NAME,
          coalesce((new_j ->> 'id')::bigint, (old_j ->> 'id')::bigint),
          old_j, new_j);
  RETURN coalesce(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company', 'security', 'person', 'person_alias', 'person_affiliation',
                           'board_membership', 'board_role', 'board_event', 'corporate_action',
                           'coverage_period', 'benchmark']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION bt_audit()', t || '_audit', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['company', 'security', 'person', 'board_membership', 'board_role', 'board_event']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION bt_touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

-- person_identifier has a composite key, so audit it with the person id as row_id.
CREATE FUNCTION bt_audit_person_identifier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (actor, reason, action, table_name, row_id, old_row, new_row)
  VALUES (coalesce(nullif(current_setting('bt.actor', true), ''), 'db:' || session_user),
          nullif(current_setting('bt.reason', true), ''),
          TG_OP, TG_TABLE_NAME, coalesce(NEW.person_id, OLD.person_id),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER person_identifier_audit AFTER INSERT OR UPDATE OR DELETE ON person_identifier
  FOR EACH ROW EXECUTE FUNCTION bt_audit_person_identifier();
