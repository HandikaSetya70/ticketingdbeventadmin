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

    // Get the user's role
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Check if the user is a super_admin or admin
    if (userData.role !== 'super_admin' && userData.role !== 'admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized. Admin or super admin access required.'
      });
    }

    // Get pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Get optional filters
    const eventId = req.query.event_id;
    const permissionLevel = req.query.permission_level;

    // Build the query
    let query = supabase
      .from('event_admins')
      .select(`
        id,
        user_id,
        event_id,
        permission_level,
        created_at,
        created_by,
        users:user_id (user_id, id_name, id_number, auth_id),
        events:event_id (event_id, event_name, event_date, venue)
      `)
      .order('created_at', { ascending: false });
    
    // Add filters if provided
    if (eventId) {
      query = query.eq('event_id', eventId);
    }
    
    if (permissionLevel) {
      query = query.eq('permission_level', permissionLevel);
    }

    // Count total rows for pagination
    const { count, error: countError } = await supabase
      .from('event_admins')
      .select('id', { count: 'exact', head: true })
      .order('created_at', { ascending: false });

    if (countError) {
      throw countError;
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    // Execute the query
    const { data: eventAdmins, error: eventAdminsError } = await query;

    if (eventAdminsError) {
      throw eventAdminsError;
    }

    // Format the response
    const formattedEventAdmins = eventAdmins.map(item => ({
      id: item.id,
      user_id: item.user_id,
      event_id: item.event_id,
      permission_level: item.permission_level,
      created_at: item.created_at,
      created_by: item.created_by,
      user: item.users,
      event: item.events
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(count / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Return the event admins list
    return res.status(200).json({
      status: 'success',
      message: 'Event admins retrieved successfully',
      data: {
        event_admins: formattedEventAdmins,
        pagination: {
          total: count,
          page,
          limit,
          totalPages,
          hasNextPage,
          hasPrevPage
        }
      }
    });

  } catch (error) {
    console.error('Error retrieving event admins:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while retrieving event admins',
      error: error.message
    });
  }
}