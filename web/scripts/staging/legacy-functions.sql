-- ============================================================
-- DATABASE FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT organisation_id FROM organisation_members WHERE user_id = _user_id AND status = 'active' LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.get_user_org_role(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT org_role FROM organisation_members WHERE user_id = _user_id AND status = 'active' LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.backfill_org_data(_user_id uuid, _org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.jobs SET organisation_id = _org_id WHERE client_id = _user_id AND organisation_id IS NULL;
  UPDATE public.properties SET organisation_id = _org_id WHERE client_id = _user_id AND organisation_id IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_create_organisation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_org_id uuid;
  v_name text;
BEGIN
  IF NEW.role != 'client' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM organisation_members WHERE user_id = NEW.user_id AND status = 'active') THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(p.company_name,''), NULLIF(p.full_name,''), 'My Organisation')
  INTO v_name FROM profiles p WHERE p.user_id = NEW.user_id;
  v_name := COALESCE(v_name, 'My Organisation');

  INSERT INTO organisations (name, created_by) VALUES (v_name, NEW.user_id) RETURNING id INTO v_org_id;
  INSERT INTO organisation_members (organisation_id, user_id, org_role, status) VALUES (v_org_id, NEW.user_id, 'owner', 'active');
  PERFORM backfill_org_data(NEW.user_id, v_org_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_job_actor_names()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.created_by_user_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id AND NEW.created_by_user_id IS NOT NULL)
  THEN
    SELECT full_name INTO NEW.created_by_name FROM public.profiles WHERE user_id = NEW.created_by_user_id;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.assigned_by IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.assigned_by IS DISTINCT FROM OLD.assigned_by AND NEW.assigned_by IS NOT NULL)
  THEN
    SELECT full_name INTO NEW.assigned_by_name FROM public.profiles WHERE user_id = NEW.assigned_by;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_clerk_on_job_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_address TEXT; v_city TEXT; v_type TEXT; v_type_label TEXT; v_admin RECORD;
BEGIN
  SELECT p.address_line_1, p.city, NEW.inspection_type::text INTO v_address, v_city, v_type
  FROM public.properties p WHERE p.id = NEW.property_id;

  v_type_label := CASE v_type
    WHEN 'new_inventory' THEN 'New Inventory' WHEN 'check_in' THEN 'Check-In'
    WHEN 'check_out' THEN 'Check-Out' WHEN 'mid_term' THEN 'Mid-Term'
    WHEN 'interim' THEN 'Interim' ELSE initcap(replace(v_type, '_', ' '))
  END;

  IF OLD.clerk_id IS NULL AND NEW.clerk_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.clerk_id, 'job', 'Job Assigned to You',
      v_type_label || ' at ' || COALESCE(v_address, 'your property') || ', ' || COALESCE(v_city, ''),
      '/dashboard/jobs/' || NEW.id);
  ELSIF OLD.client_pre_inspection_ack IS DISTINCT FROM NEW.client_pre_inspection_ack
    AND NEW.client_pre_inspection_ack = TRUE AND NEW.clerk_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.clerk_id, 'job', 'Client Confirmed Job Details',
      'The client has verified property details for the ' || v_type_label || ' at ' || COALESCE(v_address, 'the property'),
      '/dashboard/jobs/' || NEW.id);
  ELSIF OLD.client_report_accepted IS DISTINCT FROM NEW.client_report_accepted
    AND NEW.client_report_accepted = TRUE AND NEW.clerk_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.clerk_id, 'payment', 'Report Accepted — Payment Processing',
      'Your report for ' || COALESCE(v_address, 'the property') || ' has been accepted. Payment will be released shortly.',
      '/dashboard/payments');
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted' AND NEW.clerk_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.client_id, 'job', 'Your Clerk is Confirmed',
      'A clerk has been assigned to your ' || v_type_label || ' at ' || COALESCE(v_address, 'your property') || ', ' || COALESCE(v_city, ''),
      '/dashboard/jobs/' || NEW.id);
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'submitted' THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (NEW.client_id, 'job', 'Report Ready to Review',
      'Your ' || v_type_label || ' report for ' || COALESCE(v_address, 'your property') || ', ' || COALESCE(v_city, '') || ' is ready. Please review and accept.',
      '/dashboard/jobs/' || NEW.id);
  END IF;

  IF OLD.client_report_accepted IS DISTINCT FROM NEW.client_report_accepted AND NEW.client_report_accepted = TRUE THEN
    FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, type, title, message, link)
      VALUES (v_admin.user_id, 'payment', 'Escrow Release Required',
        'Client accepted the ' || v_type_label || ' report for ' || COALESCE(v_address, 'a property') || ', ' || COALESCE(v_city, '') || '. Please release the escrow payment.',
        '/dashboard/jobs/' || NEW.id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_property_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_address TEXT; v_city TEXT; v_changes jsonb; v_summary TEXT; v_pricing_note TEXT := '';
  v_admin RECORD; v_job RECORD; v_field TEXT; v_parts TEXT[] := '{}';
  v_field_labels jsonb := '{
    "address_line_1": "Address", "address_line_2": "Address Line 2", "city": "City", "postcode": "Postcode",
    "property_type": "Property Type", "bedrooms": "Bedrooms", "bathrooms": "Bathrooms", "kitchens": "Kitchens",
    "living_rooms": "Living Rooms", "dining_areas": "Dining Areas", "utility_rooms": "Utility Rooms",
    "storage_rooms": "Storage Rooms", "hallways_stairs": "Hallways", "gardens": "Gardens",
    "communal_areas": "Communal Areas", "furnished_status": "Furnished Status", "heavily_furnished": "Heavily Furnished"
  }'::jsonb;
BEGIN
  SELECT p.address_line_1, p.city INTO v_address, v_city FROM public.properties p WHERE p.id = NEW.property_id;
  v_changes := NEW.changes;
  FOR v_field IN SELECT jsonb_object_keys(v_changes) LOOP
    v_parts := array_append(v_parts,
      COALESCE(v_field_labels->>v_field, v_field) || ': ' ||
      COALESCE((v_changes->v_field->>'old')::text, '—') || ' → ' ||
      COALESCE((v_changes->v_field->>'new')::text, '—'));
  END LOOP;
  v_summary := array_to_string(v_parts, ', ');
  IF NEW.may_affect_pricing THEN v_pricing_note := ' Pricing review may be required.'; END IF;

  FOR v_job IN SELECT id, clerk_id FROM public.jobs WHERE property_id = NEW.property_id AND status NOT IN ('completed', 'paid', 'cancelled') LOOP
    FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (v_admin.user_id, 'job', 'Property Details Changed', v_summary || '.' || v_pricing_note, '/dashboard/jobs/' || v_job.id);
    END LOOP;
    IF v_job.clerk_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (v_job.clerk_id, 'job', 'Property Details Changed', v_summary || '.' || v_pricing_note, '/dashboard/jobs/' || v_job.id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_org_on_job_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_address TEXT; v_org_owner_id uuid; v_creator_id uuid; v_msg TEXT; v_title TEXT;
BEGIN
  IF NEW.organisation_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.address_line_1 INTO v_address FROM public.properties p WHERE p.id = NEW.property_id;
  v_creator_id := NEW.created_by_user_id;
  SELECT om.user_id INTO v_org_owner_id FROM public.organisation_members om
  WHERE om.organisation_id = NEW.organisation_id AND om.org_role = 'owner' AND om.status = 'active' LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    v_title := 'New Booking Created'; v_msg := 'A booking has been created for ' || COALESCE(v_address, 'a property');
    IF v_org_owner_id IS NOT NULL AND v_org_owner_id IS DISTINCT FROM v_creator_id THEN
      INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (v_org_owner_id, 'job', v_title, v_msg, '/dashboard/jobs/' || NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'cancelled' THEN v_title := 'Booking Cancelled'; v_msg := 'Booking for ' || COALESCE(v_address, 'a property') || ' has been cancelled.';
      ELSE v_title := 'Booking Updated'; v_msg := 'Status changed to ' || NEW.status || ' for ' || COALESCE(v_address, 'a property'); END IF;
    ELSIF OLD.reschedule_requested_at IS NULL AND NEW.reschedule_requested_at IS NOT NULL THEN
      v_title := 'Reschedule Requested'; v_msg := 'A reschedule has been requested for ' || COALESCE(v_address, 'a property');
    ELSIF OLD.special_instructions IS DISTINCT FROM NEW.special_instructions THEN
      v_title := 'Booking Details Updated'; v_msg := 'Special instructions updated for ' || COALESCE(v_address, 'a property');
    ELSE RETURN NEW; END IF;

    IF v_creator_id IS NOT NULL AND v_creator_id IS DISTINCT FROM v_org_owner_id THEN
      INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (v_creator_id, 'job', v_title, v_msg, '/dashboard/jobs/' || NEW.id);
    END IF;
    IF v_org_owner_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (v_org_owner_id, 'job', v_title, v_msg, '/dashboard/jobs/' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_tenant_portal_token(_tenant_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_token text;
BEGIN
  v_token := encode(gen_random_bytes(32), 'hex');
  UPDATE tenant_details SET tenant_token = v_token WHERE id = _tenant_id;
  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_portal_data(_token text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant record; v_job record; v_property record; v_reports json;
BEGIN
  SELECT * INTO v_tenant FROM tenant_details WHERE tenant_token = _token LIMIT 1;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_job FROM jobs WHERE id = v_tenant.job_id LIMIT 1;
  IF v_job IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_property FROM properties WHERE id = v_job.property_id LIMIT 1;
  SELECT json_agg(row_to_json(sub)) INTO v_reports FROM (
    SELECT id, job_id, generated_at, report_url, tenant_signature, signed_at FROM generated_reports WHERE job_id = v_tenant.job_id ORDER BY generated_at DESC
  ) sub;
  RETURN json_build_object(
    'tenant', json_build_object('id', v_tenant.id, 'full_name', v_tenant.full_name, 'email', v_tenant.email, 'phone', v_tenant.phone, 'job_id', v_tenant.job_id),
    'job', json_build_object('id', v_job.id, 'inspection_type', v_job.inspection_type, 'scheduled_date', v_job.scheduled_date, 'status', v_job.status),
    'property', json_build_object('address_line_1', v_property.address_line_1, 'address_line_2', v_property.address_line_2, 'city', v_property.city, 'postcode', v_property.postcode),
    'reports', COALESCE(v_reports, '[]'::json));
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_report_detail(_token text, _job_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant_id uuid; v_rooms json;
BEGIN
  SELECT id INTO v_tenant_id FROM tenant_details WHERE tenant_token = _token AND job_id = _job_id LIMIT 1;
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;
  SELECT json_agg(json_build_object('id', r.id, 'room_name', r.room_name, 'room_order', r.room_order,
    'items', (SELECT COALESCE(json_agg(json_build_object('id', i.id, 'item_name', i.item_name, 'condition', i.condition, 'notes', i.notes,
      'photos', (SELECT COALESCE(json_agg(json_build_object('id', p.id, 'photo_url', p.photo_url)), '[]'::json) FROM inspection_item_photos p WHERE p.item_id = i.id)
    )), '[]'::json) FROM inspection_items_map i WHERE i.room_id = r.id AND i.job_id = _job_id)
  ) ORDER BY r.room_order) INTO v_rooms FROM inspection_rooms_map r WHERE r.job_id = _job_id;
  RETURN COALESCE(v_rooms, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_sign_report(_token text, _report_id uuid, _signature text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_job_id uuid;
BEGIN
  SELECT job_id INTO v_job_id FROM tenant_details WHERE tenant_token = _token LIMIT 1;
  IF v_job_id IS NULL THEN RETURN false; END IF;
  UPDATE generated_reports SET tenant_signature = _signature, signed_at = now() WHERE id = _report_id AND job_id = v_job_id AND signed_at IS NULL;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token uuid)
RETURNS TABLE(id uuid, provider_id uuid, email text, token uuid, status text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT id, provider_id, email, token, status, created_at, expires_at, accepted_at
  FROM public.clerk_invitations WHERE clerk_invitations.token = _token AND clerk_invitations.status = 'pending' AND clerk_invitations.expires_at > now() LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_xero_connection()
RETURNS TABLE(tenant_name text, token_expires_at timestamptz, connected_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT tenant_name, token_expires_at, connected_at FROM xero_connections WHERE user_id = auth.uid() ORDER BY connected_at DESC LIMIT 1;
$function$;
