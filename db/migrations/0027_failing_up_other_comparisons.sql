-- Every other index or peer group in the same table at the same end point, so a case that trails the
-- S&P 500 but beat its own sector shows both: [{name, value_of_100}].
ALTER TABLE failing_up_case ADD COLUMN other_comparisons jsonb NOT NULL DEFAULT '[]';
