import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

// Supabase realtime client requires global WebSocket constructor in Node < 22
if (!globalThis.WebSocket) {
  globalThis.WebSocket = ws as any;
}

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';  
// Use SERVICE key (not anon key) for storage uploads

let _supabase: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials missing: set SUPABASE_URL and SUPABASE_SERVICE_KEY');
    }
    _supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
  }
  return _supabase;
}

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : (new Proxy({}, {
      get(_target, prop) {
        return (getSupabase() as any)[prop];
      }
    }) as ReturnType<typeof createClient>);

/**
 * Upload a buffer to Supabase Storage and return the public URL.
 */
export async function uploadToStorage(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Generate a signed URL for private files.
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new Error(`Failed to generate signed URL: ${error?.message ?? 'unknown error'}`);
  }

  return data.signedUrl;
}
