-- Market reaction to board changes: a market-model event study on each company-day with an
-- announced board join or departure. Several announcements on one day are one event.
CREATE TABLE director_event (
  company_id       bigint NOT NULL REFERENCES company,
  day0             date NOT NULL,              -- first trading day on or after the announcement
  announced_date   date NOT NULL,
  category         text NOT NULL CHECK (category IN ('appointed', 'elected', 'resigned', 'not_standing',
                                                     'exec_change')),
  people           bigint[] NOT NULL,
  event_ids        bigint[] NOT NULL,
  summaries        text[] NOT NULL,
  bundled          boolean NOT NULL,           -- more than one board change that day
  n_estimation     integer NOT NULL,
  alpha            double precision NOT NULL,
  beta             double precision NOT NULL,
  sigma            double precision NOT NULL,  -- daily residual standard deviation in the estimation window
  ar_m1            double precision NOT NULL,
  ar_0             double precision NOT NULL,
  ar_p1            double precision NOT NULL,
  car              double precision NOT NULL,  -- ar_m1 + ar_0 + ar_p1
  start_market_cap numeric(20, 0),
  methodology_version text NOT NULL,
  PRIMARY KEY (company_id, day0, category)
);
