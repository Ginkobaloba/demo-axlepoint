-- Drop everything db/schema.sql creates, so it can be applied to a clean slate.
--
-- SEPARATE FROM schema.sql ON PURPOSE. schema.sql is a bootstrap that a
-- production deploy runs; it must not carry DROP statements, or a stray
-- re-apply becomes a data-loss event. This file is for development and tests,
-- which genuinely want the slate wiped.
--
-- IT EXISTS BECAUSE THE LIST KEPT GETTING OUT OF DATE. Adding `pristine`, then
-- `ops`, each broke every caller that had its own hand-written DROP line, and
-- each broke it in the same way: "schema already exists" from a seed that had
-- worked five minutes earlier. One list, one place to update.
DROP SCHEMA IF EXISTS ops CASCADE;
DROP SCHEMA IF EXISTS pristine CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
