-- Module 7: Text-to-SQL Tool
-- Create execute_readonly_query RPC for safe read-only SQL execution

CREATE OR REPLACE FUNCTION execute_readonly_query(query_text text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  normalized text;
BEGIN
  -- Normalize: trim whitespace, lowercase for validation
  normalized := lower(trim(query_text));

  -- Validate SELECT-only (reject DML/DDL)
  IF normalized !~ '^(select|with)\s' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Reject dangerous keywords
  IF normalized ~ '(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|exec)\s' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Execute with statement timeout and row limit
  EXECUTE format('SET LOCAL statement_timeout = ''5000''');

  EXECUTE format(
    'SELECT jsonb_agg(row_to_json(t)) FROM (SELECT * FROM (%s) sub LIMIT 50) t',
    query_text
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
