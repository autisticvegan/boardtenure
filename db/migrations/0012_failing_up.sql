-- Executives who left company A after A's own filings showed a large loss or shortfall during
-- their tenure, then became an executive at company B. Figures are the filings' own.
CREATE TABLE failing_up_case (
  id                       text PRIMARY KEY,
  person_name              text NOT NULL,
  person_cik               text,
  from_company             text NOT NULL,
  from_ticker              text,
  from_role                text NOT NULL,
  from_start               text,
  from_end                 text,
  exit_description         text,
  from_value_of_100        double precision NOT NULL,
  comparison_name          text NOT NULL,
  comparison_value_of_100  double precision NOT NULL,
  period_start             date,
  period_end               date,
  exit_pay_total           numeric(16, 0),
  exit_pay_description     text,
  to_company               text NOT NULL,
  to_ticker                text,
  to_role                  text NOT NULL,
  to_start                 text,
  pay                      jsonb NOT NULL,          -- [{fiscal_year, total}]
  notes                    text,
  source_urls              text[] NOT NULL,
  evidence_ids             bigint[] NOT NULL
);
