import { createClient } from '@supabase/supabase-js';

// The backend should ideally use the SERVICE_ROLE_KEY to bypass RLS for background tasks.
// If it's not provided, it falls back to the ANON_KEY (which may be blocked by RLS for background jobs).
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn("Missing Supabase URL or Key in environment variables!");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// We keep initDb for backwards compatibility in server.ts, but it no longer creates SQLite tables.
export function initDb() {
  console.log("Supabase client initialized via db.ts");
}

export { supabase as db };
