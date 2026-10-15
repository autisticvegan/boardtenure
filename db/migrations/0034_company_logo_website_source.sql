ALTER TABLE company_logo ADD COLUMN website_source text CHECK (website_source IN ('wikidata', 'proxy'));
