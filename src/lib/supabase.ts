import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ohvmgletljlhudjczxpc.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9odm1nbGV0bGpsaHVkamN6eHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MTM3MDMsImV4cCI6MjExMTE4OTcwM30.we8uEMJUKMDo4xjdhI1gZbczUe3iPkimr8DX6uo8Kvg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
