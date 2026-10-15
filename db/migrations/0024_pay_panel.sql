-- Year-by-year CEO pay panel read from each screened company's latest pay-versus-performance proxy:
-- who the CEO (PEO) was each year, their reported and "actually paid" pay, and the company's TSR.
-- The frames API only returns undimensioned facts, so it can't say whether the same person held the
-- job in consecutive years; the proxy's own ecd:PeoName and ecd:IndividualAxis tags can.
CREATE TABLE pvp_panel_filing (
  cik        bigint PRIMARY KEY,
  accession  text NOT NULL,
  doc_url    text,
  status     text NOT NULL CHECK (status IN ('ok', 'no_ixbrl', 'error')),
  detail     text,
  parsed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pvp_panel_year (
  cik         bigint NOT NULL,
  accession   text NOT NULL,
  period_end  date NOT NULL,
  tsr         numeric(16, 4),           -- value of $100 at the table's base date
  peer_tsr    numeric(16, 4),
  peo_count   integer NOT NULL,         -- people tagged as PEO for the year (two = a mid-year change)
  PRIMARY KEY (cik, accession, period_end)
);

CREATE TABLE pvp_panel_peo (
  cik         bigint NOT NULL,
  accession   text NOT NULL,
  period_end  date NOT NULL,
  peo_key     text NOT NULL,            -- the IndividualAxis member, or '' for an undimensioned fact
  peo_name    text,
  name_basis  text CHECK (name_basis IN ('member', 'year', 'sole')),  -- how the name was tied to the year
  sct         numeric(18, 2),           -- Summary Compensation Table total
  cap         numeric(18, 2),           -- compensation actually paid
  PRIMARY KEY (cik, accession, period_end, peo_key)
);

-- Consecutive fiscal years with the same full-year CEO: the pay change against the stock's return.
CREATE TABLE pay_change (
  cik          bigint NOT NULL,
  accession    text NOT NULL,
  period_end   date NOT NULL,           -- year t
  peo_name     text NOT NULL,
  sct_prev     numeric(18, 2) NOT NULL,
  sct          numeric(18, 2) NOT NULL,
  cap_prev     numeric(18, 2),
  cap          numeric(18, 2),
  ret          double precision NOT NULL,   -- total shareholder return in year t
  ret_prev     double precision,            -- in year t-1, when the table covers it
  peer_ret     double precision,
  peer_ret_prev double precision,
  PRIMARY KEY (cik, period_end)
);

-- Summary statistics written by the analytics step (one row per statistic set).
CREATE TABLE pay_asymmetry_stat (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
