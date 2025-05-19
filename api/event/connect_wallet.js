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

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
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

    // Get request body
    const { event_id, wallet_address, wallet_role = 'minter' } = req.body;
    
    if (!event_id || !wallet_address) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: event_id and wallet_address'
      });
    }

    // Validate wallet address format
    const isValidWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(wallet_address);
    if (!isValidWalletAddress) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid wallet address format'
      });
    }

    // Verify the user is an event admin for this event
    const { data: eventAdmin, error: eventAdminError } = await supabase
      .from('event_admins')
      .select('id, user_id, permission_level')
      .eq('auth_id', user.id)
      .eq('event_id', event_id)
      .single();

    if (eventAdminError || !eventAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'User is not authorized to manage this event'
      });
    }

    // Get the admin's user_id from the users table if not already associated
    let admin_id = eventAdmin.user_id;
    
    if (!admin_id) {
      const { data: adminUser, error: adminUserError } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();
      
      if (adminUserError || !adminUser) {
        return res.status(404).json({
          status: 'error',
          message: 'Admin user profile not found'
        });
      }
      
      admin_id = adminUser.user_id;
    }

    // Check if the event exists
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('event_id, event_name')
      .eq('event_id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        status: 'error',
        message: 'Event not found'
      });
    }

    // Check if wallet is already connected to this event
    const { data: existingWallet, error: existingWalletError } = await supabase
      .from('admin_wallets')
      .select('wallet_id')
      .eq('wallet_address', wallet_address)
      .eq('event_id', event_id)
      .eq('is_active', true)
      .maybeSingle();

    if (existingWallet) {
      return res.status(400).json({
        status: 'error',
        message: 'This wallet is already connected to this event',
        data: { wallet_id: existingWallet.wallet_id }
      });
    }

    // Create new admin wallet entry
    const { data: newWallet, error: newWalletError } = await supabase
      .from('admin_wallets')
      .insert([{
        admin_id: admin_id,
        wallet_address: wallet_address,
        role: wallet_role,
        event_id: event_id,
        is_active: true
      }])
      .select()
      .single();

    if (newWalletError) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to connect wallet',
        error: newWalletError.message
      });
    }

    // Also update the event's wallet information if the wallet role is 'primary'
    if (wallet_role === 'primary') {
      const { error: updateEventError } = await supabase
        .from('events')
        .update({ 
          wallet_address: wallet_address,
          wallet_connected: true
        })
        .eq('event_id', event_id);

      if (updateEventError) {
        console.error('Warning: Failed to update event wallet info:', updateEventError);
        // Continue anyway as the admin wallet was created
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Wallet connected successfully',
      data: {
        wallet_id: newWallet.wallet_id,
        admin_id: admin_id,
        event_id: event_id,
        wallet_address: wallet_address,
        role: wallet_role,
        added_at: newWallet.added_at
      }
    });

  } catch (error) {
    console.error('Error connecting wallet:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while connecting wallet',
      error: error.message
    });
  }
}