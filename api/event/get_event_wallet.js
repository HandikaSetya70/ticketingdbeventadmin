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

    // Get user ID and role
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

    // Check if user has proper role
    if (userData.role !== 'event_admin' && userData.role !== 'admin' && userData.role !== 'super_admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized. Admin or event admin access required.'
      });
    }

    let eventId;

    // Handle optional event_id parameter for admins who want to check specific events
    if (req.query.event_id) {
      // If specific event_id is provided, check permissions
      if (userData.role === 'admin' || userData.role === 'super_admin') {
        // Admins can access any event wallet
        eventId = req.query.event_id;
      } else {
        // For event_admin, verify they are actually assigned to this event
        const { data: eventAdmin, error: eventAdminError } = await supabase
          .from('event_admins')
          .select('event_id')
          .eq('user_id', userData.user_id)
          .eq('event_id', req.query.event_id)
          .single();

        if (eventAdminError || !eventAdmin) {
          return res.status(403).json({
            status: 'error',
            message: 'Unauthorized. You do not have access to this event.'
          });
        }
        
        eventId = eventAdmin.event_id;
      }
    } else if (userData.role === 'event_admin') {
      // If no event_id specified and user is event_admin, get their assigned event
      const { data: eventAdmin, error: eventAdminError } = await supabase
        .from('event_admins')
        .select('event_id')
        .eq('user_id', userData.user_id)
        .single();

      if (eventAdminError) {
        if (eventAdminError.code === 'PGRST116') { // No rows returned
          return res.status(404).json({
            status: 'error',
            message: 'No event connected to this admin'
          });
        }
        throw eventAdminError;
      }
      
      eventId = eventAdmin.event_id;
    } else {
      // Admins must specify which event they want to check
      return res.status(400).json({
        status: 'error',
        message: 'event_id parameter is required for admin users'
      });
    }

    // Check if the event has a connected wallet
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('wallet_address, wallet_connected, blockchain_network, is_nft_enabled, nft_contract_address')
      .eq('event_id', eventId)
      .single();

    if (eventError) {
      throw eventError;
    }

    // Get additional wallet details from admin_wallets table if available
    let walletDetails = null;
    
    if (event.wallet_address) {
      const { data: walletData, error: walletError } = await supabase
        .from('admin_wallets')
        .select('wallet_id, wallet_address, role, added_at, is_active')
        .eq('event_id', eventId)
        .eq('wallet_address', event.wallet_address)
        .eq('is_active', true)
        .single();

      if (!walletError && walletData) {
        walletDetails = walletData;
      }
    }

    // Return wallet information
    return res.status(200).json({
      status: 'success',
      message: event.wallet_connected ? 'Event wallet retrieved successfully' : 'No wallet connected to this event',
      data: {
        event_id: eventId,
        wallet_address: event.wallet_address || null,
        wallet_connected: event.wallet_connected || false,
        blockchain_network: event.blockchain_network || 'sepolia',
        is_nft_enabled: event.is_nft_enabled || false,
        nft_contract_address: event.nft_contract_address || null,
        wallet_details: walletDetails
      }
    });

  } catch (error) {
    console.error('Error retrieving event wallet:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while retrieving the event wallet',
      error: error.message
    });
  }
}