-- Migration 023: Scope farmer National ID and Account Number uniqueness per tenant/owner
-- and drop redundant duplicate index from migration 021.

-- 1. Drop global partial unique indexes on farmers table
DROP INDEX IF EXISTS public.uq_farmers_national_id;
DROP INDEX IF EXISTS public.uq_farmers_account_number;

-- 2. Create tenant-scoped partial unique indexes (scoped to owner_user_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_owner_national_id 
  ON public.farmers (owner_user_id, national_id) 
  WHERE national_id IS NOT NULL AND BTRIM(national_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_farmers_owner_account_number 
  ON public.farmers (owner_user_id, account_number) 
  WHERE account_number IS NOT NULL AND BTRIM(account_number) <> '';

-- 3. Drop redundant duplicate index (uq_farmers_owner_farmer_number on (owner_user_id, farmer_number) already covers this)
DROP INDEX IF EXISTS public.idx_farmers_owner_number;
