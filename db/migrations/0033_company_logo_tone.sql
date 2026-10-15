-- 'light' icons (white marks on a transparent background) need a dark chip to be visible.
ALTER TABLE company_logo ADD COLUMN tone text CHECK (tone IN ('light', 'dark', 'opaque'));
