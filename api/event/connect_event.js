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
    const { event_id, wallet_address } = req.body;
    
    if (!event_id || !wallet_address) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: event_id and wallet_address'
      });
    }

    // Verify the user is an event admin for this event
    const { data: eventAdmin, error: eventAdminError } = await supabase
      .from('event_admins')
      .select('id, permission_level')
      .eq('auth_id', user.id)
      .eq('event_id', event_id)
      .single();

    if (eventAdminError || !eventAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'User is not authorized to manage this event'
      });
    }

    // Check if wallet address is valid
    const isValidWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(wallet_address);
    if (!isValidWalletAddress) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid wallet address format'
      });
    }

    // Update the event with the wallet address
    const { data: updatedEvent, error: updateError } = await supabase
      .from('events')
      .update({ 
        wallet_address: wallet_address,
        wallet_connected: true
      })
      .eq('event_id', event_id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to connect wallet to event',
        error: updateError.message
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Wallet connected to event successfully',
      data: {
        event_id: updatedEvent.event_id,
        wallet_address: updatedEvent.wallet_address
      }
    });

  } catch (error) {
    console.error('Error connecting wallet to event:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while connecting wallet to event',
      error: error.message
    });
  }
}