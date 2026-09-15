-- RLS ownership-policy template for a directly user-owned table.
-- Fill in <table_name> (must have a `user_id` column referencing users.id)
-- and run against the Supabase project after the table exists.
--
-- For a table owned via a repository (no direct user_id column, but a
-- repository_id that traces to one), replace `auth.uid()::text = user_id`
-- in every clause below with:
--   EXISTS (
--     SELECT 1 FROM repositories r
--     WHERE r.id = <table_name>.repository_id AND r.user_id = auth.uid()::text
--   )
--
-- Verify afterward with:
--   SELECT relrowsecurity FROM pg_class WHERE relname = '<table_name>';
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = '<table_name>';

ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <table_name>_select_own ON <table_name>
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY <table_name>_insert_own ON <table_name>
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY <table_name>_update_own ON <table_name>
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY <table_name>_delete_own ON <table_name>
  FOR DELETE USING (auth.uid()::text = user_id);
