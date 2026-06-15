-- Cover image + link metadata pulled from Luma when an event is attached.
alter table event add column cover_image_url text;
alter table event add column luma_url text;
alter table event add column luma_name text;
