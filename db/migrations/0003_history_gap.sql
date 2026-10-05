-- A tenure that starts before the earliest stored price for a security that was already
-- listed then can't be measured yet; distinct from joining before the listing.
ALTER TABLE tenure_performance DROP CONSTRAINT tenure_performance_status_check;
ALTER TABLE tenure_performance ADD CONSTRAINT tenure_performance_status_check
  CHECK (status IN ('ok', 'approximate', 'too_short', 'no_price_history', 'unknown_dates', 'history_gap'));
