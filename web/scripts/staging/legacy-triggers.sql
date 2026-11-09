-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auth trigger (create in auth schema on your new project)
-- CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers
CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON public.disputes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_escrow_payments_updated_at BEFORE UPDATE ON public.escrow_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inspection_items_updated_at BEFORE UPDATE ON public.inspection_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inspection_reports_updated_at BEFORE UPDATE ON public.inspection_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inspection_rooms_updated_at BEFORE UPDATE ON public.inspection_rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_xero_connections_updated_at BEFORE UPDATE ON public.xero_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_platform_settings_updated_at BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tenant_details_updated_at BEFORE UPDATE ON public.tenant_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Business logic triggers
CREATE TRIGGER trg_snapshot_job_actor_names BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION snapshot_job_actor_names();
CREATE TRIGGER trg_notify_clerk_on_job_update AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_clerk_on_job_update();
CREATE TRIGGER notify_org_on_job_change_trigger AFTER INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_org_on_job_change();
CREATE TRIGGER on_client_role_created AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION auto_create_organisation();
-- ============================================================
-- AUTH TRIGGER (run this after everything else)
-- This creates a profile automatically when a user signs up
-- ============================================================

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
