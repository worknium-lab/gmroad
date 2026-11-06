import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL = process.env.SUPABASE_INTERNAL_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다'); process.exit(1); }

export const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'gm' } });
export const idToEmail = (id) => `${String(id).trim().toLowerCase()}@gm.local`;
export const tempPassword = () => 'gm-' + crypto.randomBytes(4).toString('hex');
