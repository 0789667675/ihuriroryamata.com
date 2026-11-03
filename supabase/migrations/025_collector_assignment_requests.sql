-- Migration 025: Collector membership requests and MCC decisions
--
-- Business need
-- -------------
-- Collectors can request membership in an existing Collection Center account
-- without creating a duplicate user/profile. The request stays `pending` until
-- the Collection Center explicitly approves or rejects it. Direct linking by a
-- Collection Center remains supported and closes a matching pending request.
--
-- This migration is additive only. It does not backfill, rewrite, or delete any
-- existing `collector_assignments` history, farmers, milk records, deductions,
-- settlements, debts, Ifishi, or Ukwezi data.
--
-- Schema limitation
-- -----------------
-- The current ownership model links a Collector to one Collection Center owner
-- (`users.id`) and migration 011 keeps `uq_collector_assignments_active_collector`
-- on `collector_user_id WHERE revoked_at IS NULL`. That means a Collector can
-- have only one active Collection Center membership at a time. This request
-- table intentionally records the requested Collection Center user id only; it
-- does not introduce a multi-center or organization model.
--
-- Suspension note
-- ---------------
-- There is no separate reversible `suspended` state on `collector_assignments`.
-- Suspension closes the current historical assignment (same `revoked_at`
-- semantics as revocation) and records a distinct `audit_logs.action` value.
-- Re-linking creates a new assignment row, preserving the previous period.

CREATE TABLE IF NOT EXISTS public.collector_assignment_requests (
  id BIGSERIAL PRIMARY KEY,
  dairy_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  collector_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_note VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note VARCHAR(500),
  approved_assignment_id BIGINT REFERENCES public.collector_assignments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collector_assignment_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT collector_assignment_requests_decision_check
    CHECK (
      (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_at IS NOT NULL)
    )
);

ALTER TABLE public.collector_assignment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_system_deny_data_api_access
ON public.collector_assignment_requests
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- The application connects as the table owner (`postgres`) and bypasses RLS.
-- `service_role` is granted only for trusted server-side operations, matching
-- the repository-wide Data API hardening convention.
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.collector_assignment_requests
TO service_role;

GRANT USAGE, SELECT
ON SEQUENCE public.collector_assignment_requests_id_seq
TO service_role;

-- A Collector cannot have two simultaneous pending requests for the same
-- Collection Center. Different Collection Centers may each hold a request; if
-- one approves, the approval path cancels the Collector's other pending
-- requests because the current schema supports only one active membership.
CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_assignment_requests_pending_pair
  ON public.collector_assignment_requests (dairy_user_id, collector_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_collector_assignment_requests_dairy_status
  ON public.collector_assignment_requests (dairy_user_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_collector_assignment_requests_collector_status
  ON public.collector_assignment_requests (collector_user_id, status, requested_at DESC);
