-- Paws v4: short videos (up to 3 s, sped up on the phone). Run once after supabase_v3.sql. Safe to run again.

alter table public.pets add column if not exists video_path text;

-- the photo bucket now also takes small MP4 videos (max 8 MB per file)
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
       file_size_limit    = 8388608
 where id = 'pet-photos';

notify pgrst, 'reload schema';
