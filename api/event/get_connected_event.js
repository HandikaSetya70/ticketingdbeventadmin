import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      status: 'error', 
      message: 'Method not allowed' 
    });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the token and get user details
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    // Get the user's details including role
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Check if the user is an event admin
    if (userData.role !== 'admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized. Event admin access required.'
      });
    }

    // Look for event admin relationship in the event_admins table
    const { data: eventAdmin, error: eventAdminError } = await supabase
      .from('event_admins')
      .select('event_id, permission_level')
      .eq('user_id', userData.user_id)
      .single();

    if (eventAdminError && eventAdminError.code !== 'PGRST116') { // PGRST116 is "No rows returned" which is ok
      throw eventAdminError;
    }

    if (!eventAdmin) {
      return res.status(200).json({
        status: 'success',
        message: 'No event connected to this admin',
        data: null
      });
    }

    // Get the event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', eventAdmin.event_id)
      .single();

    if (eventError) {
      throw eventError;
    }

    // Get ticket availability information for this event
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('ticket_status')
      .eq('event_id', eventAdmin.event_id);

    if (ticketsError) {
      throw ticketsError;
    }

    // Calculate ticket statistics
    const availability = {
      total_tickets: tickets ? tickets.length : 0,
      available_tickets: tickets ? tickets.filter(t => t.ticket_status === 'valid' && !t.user_id).length : 0,
      sold_tickets: tickets ? tickets.filter(t => t.ticket_status === 'valid' && t.user_id).length : 0,
      revoked_tickets: tickets ? tickets.filter(t => t.ticket_status === 'revoked').length : 0
    };

    // Return the connected event with permission level and availability
    return res.status(200).json({
      status: 'success',
      message: 'Connected event retrieved successfully',
      data: {
        ...event,
        permission_level: eventAdmin.permission_level,
        availability
      }
    });

  } catch (error) {
    console.error('Error retrieving connected event:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while retrieving the connected event',
      error: error.message
    });
  }
}