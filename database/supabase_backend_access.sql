-- Backend access after the privacy wall.
-- 1. Run database/supabase_core_billing.sql
-- 2. Run database/supabase_tenant_privacy.sql (enables RLS)
-- 3. Put SUPABASE_SERVICE_ROLE_KEY on the server for signup, plan changes, and the Paystack webhook.
-- 4. Put SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET on the server so school screens cannot cross tenants.
--
-- Do not disable RLS. The previous version of this file turned RLS off so the
-- anon key could read every school. That is no longer the model.

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
