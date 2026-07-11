
ALTER FUNCTION public.generate_org_code() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_read_row(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_write_shop(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.generate_org_code() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_organization(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.join_organization(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.verify_org_code(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.protect_owner_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.log_activity() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_row(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_shop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_org_code(text) TO authenticated;
