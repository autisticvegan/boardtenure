-- Some filers' pay-versus-performance facts never reach the SEC's XBRL frames or company-facts APIs
-- (Apple, Microsoft and Tesla among them), though their proxies tag them. Discovery reads those
-- proxies directly; facts it stores in xbrl_frame_fact are marked source = 'proxy'.
ALTER TABLE xbrl_frame_fact ADD COLUMN source text NOT NULL DEFAULT 'frames' CHECK (source IN ('frames', 'proxy'));

CREATE TABLE pvp_discovery (
  cik         bigint PRIMARY KEY,
  status      text NOT NULL CHECK (status IN ('ok', 'no_proxy', 'no_pvp', 'error')),
  accession   text,
  detail      text,
  checked_at  timestamptz NOT NULL DEFAULT now()
);
