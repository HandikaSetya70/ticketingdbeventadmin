import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    // Token check
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ status: 'error', message: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
    }

    // Parse request body
    const { event_id, permission_level = 'editor' } = req.body;

    if (!event_id) {
      return res.status(400).json({ status: 'error', message: 'Missing required parameter: event_id' });
    }

    // Check if user already connected to the event
    const { data: existingEntry, error: lookupError } = await supabase
      .from('event_admins')
      .select('id')
      .eq('auth_id', user.id)
      .eq('event_id', event_id)
      .single();

    if (existingEntry) {
      return res.status(409).json({ status: 'error', message: 'User already connected to this event' });
    }

    // Lookup user_id from users table
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userProfile) {
      return res.status(404).json({ status: 'error', message: 'User profile not found' });
    }

    // Insert new event_admin entry
    const { data: inserted, error: insertError } = await supabase
      .from('event_admins')
      .insert([{
        auth_id: user.id,
        user_id: userProfile.user_id,
        event_id,
        permission_level,
        created_by: userProfile.user_id
      }])
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ status: 'error', message: 'Failed to connect user to event', error: insertError.message });
    }

    return res.status(200).json({
      status: 'success',
      message: 'User successfully connected to event',
      data: inserted
    });

  } catch (error) {
    console.error('Error in connect_event:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An unexpected error occurred',
      error: error.message
    });
  }
}
