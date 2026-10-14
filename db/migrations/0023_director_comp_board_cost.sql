-- Some Director Compensation tables include a director's pay as an employee (a former executive's
-- salary and awards). Such rows stay as printed but are left out of board cost.
ALTER TABLE director_comp ADD COLUMN excluded_from_board_cost boolean NOT NULL DEFAULT false;
CREATE OR REPLACE VIEW director_comp_latest AS
SELECT DISTINCT ON (dc.company_id, dc.person_id, dc.fiscal_year)
       dc.id, dc.company_id, dc.person_id, dc.fiscal_year, dc.fiscal_year_end, dc.source_document_id, dc.evidence_id,
       dc.listed_name, dc.fees_cash, dc.stock_awards, dc.option_awards, dc.non_equity_incentive, dc.pension_nqdc,
       dc.all_other, dc.total, dc.notes, sd.published_at AS filed_on, sd.url AS source_url, dc.excluded_from_board_cost
FROM director_comp dc
JOIN source_document sd ON sd.id = dc.source_document_id
ORDER BY dc.company_id, dc.person_id, dc.fiscal_year,
         abs(dc.fees_cash + dc.stock_awards + dc.option_awards + dc.non_equity_incentive + dc.pension_nqdc
             + dc.all_other - dc.total) <= 1 DESC,
         sd.published_at DESC, dc.id DESC;
