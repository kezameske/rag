-- Add is_approved column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;

-- Approve all existing users so they aren't locked out
UPDATE user_profiles SET is_approved = true;

-- Set doyubanana@gmail.com as admin + approved
UPDATE user_profiles
SET is_admin = true, is_approved = true
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'doyubanana@gmail.com' LIMIT 1
);

-- Update the trigger function to include is_approved = false for new signups
CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, is_admin, is_approved)
  VALUES (NEW.id, false, false)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
