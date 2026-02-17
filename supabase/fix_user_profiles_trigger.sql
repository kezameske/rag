-- Fix: The trigger function runs as SECURITY DEFINER (postgres role) which bypasses RLS.
-- But we also need to ensure the function owner has proper permissions.
-- Recreate the function owned by postgres with proper grants.

-- Grant INSERT on user_profiles to the trigger function's executing role
GRANT INSERT ON user_profiles TO postgres;
GRANT USAGE ON SCHEMA public TO postgres;

-- Also recreate the trigger function to ensure it's owned by postgres
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (user_id, is_admin)
    VALUES (NEW.id, false)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_profile();
