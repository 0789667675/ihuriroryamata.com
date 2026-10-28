-- Durable execution evidence for externally scheduled platform jobs.
-- A row is written for each cron invocation that acquires the advisory lock.
-- The table intentionally stores only operational metadata, never secrets or
-- email recipients.

CREATE TABLE IF NOT EXISTS platform_job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB,
  error_code VARCHAR(120)
);

-- Operational job evidence is server-side only. The browser never queries it
-- through the Supabase Data API.
ALTER TABLE public.platform_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.platform_job_runs
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_platform_job_runs_job_started
  ON platform_job_runs (job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_job_runs_failed_started
  ON platform_job_runs (started_at DESC)
  WHERE status = 'failed';

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.platform_job_runs
TO service_role;

-- Mark abandoned running rows as failed after the process has certainly exited.
-- Cron jobs are short-lived; this prevents a crashed invocation from looking
-- like it is still running forever in health diagnostics.
UPDATE platform_job_runs
SET status = 'failed',
    finished_at = COALESCE(finished_at, NOW()),
    error_code = COALESCE(error_code, 'JOB_INTERRUPTED')
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '2 hours';
