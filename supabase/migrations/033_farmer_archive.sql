-- Migration 033: Archive farmers instead of deleting their financial history.
--
-- Removing a farmer from the active directory is an archive operation. The
-- farmer row and every related milk, deduction, settlement, debt, payment, and
-- audit row stay in place. Only the active-scoped identity indexes are relaxed
-- so a person can be registered again later while the archived profile remains
-- available for historical reporting and restoration.

ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500);

COMMENT ON COLUMN public.farmers.archived_at IS
  'When the farmer was removed from the active directory. NULL means active.';
COMMENT ON COLUMN public.farmers.archived_by IS
  'Account that archived the farmer. Historical rows and audit entries are preserved.';
COMMENT ON COLUMN public.farmers.archive_reason IS
  'Reason supplied when the farmer was archived.';

CREATE INDEX IF NOT EXISTS idx_farmers_owner_active_id
  ON public.farmers (owner_user_id, id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_farmers_owner_archived_id
  ON public.farmers (owner_user_id, id DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_farmers_collector_active
  ON public.farmers (collector_user_id, owner_user_id)
  WHERE archived_at IS NULL AND collector_user_id IS NOT NULL;

-- Keep tenant-scoped uniqueness for active profiles, but allow the same
-- national ID or account number to be registered again once the old profile is
-- archived. Archived rows retain their original values for history.
DROP INDEX IF EXISTS public.uq_farmers_owner_national_id;
CREATE UNIQUE INDEX uq_farmers_owner_national_id
  ON public.farmers (owner_user_id, national_id)
  WHERE national_id IS NOT NULL AND BTRIM(national_id) <> '' AND archived_at IS NULL;

DROP INDEX IF EXISTS public.uq_farmers_owner_account_number;
CREATE UNIQUE INDEX uq_farmers_owner_account_number
  ON public.farmers (owner_user_id, account_number)
  WHERE account_number IS NOT NULL AND BTRIM(account_number) <> '' AND archived_at IS NULL;
