-- Vendor candidates carry a reference link (the UI requires some info when adding
-- one). Engagements can attach a comment/doc when advancing to Selected/Contracted.
alter table engagement_candidate add column link text;
alter table engagement add column doc_url text;

-- engagement_candidate already has table-level insert/update/delete to anon (covers
-- the new column); engagement update was column-scoped, so add doc_url.
grant update (doc_url) on engagement to anon, authenticated;

-- The Negotiating stage is retired — collapse any existing rows onto Quoted.
update engagement set stage = 'Quoted' where stage = 'Negotiating';
