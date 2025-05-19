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
    const { 
      event_id, 
      ticket_name, 
      quantity, 
      price, 
      image_url, 
      description, 
      ticket_type 
    } = req.body;
    
    if (!event_id || !ticket_name || !quantity || quantity < 1) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: event_id, ticket_name, and valid quantity'
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

    // Verify the event has a connected wallet
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('event_id, wallet_address, wallet_connected')
      .eq('event_id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        status: 'error',
        message: 'Event not found'
      });
    }

    if (!event.wallet_connected || !event.wallet_address) {
      return res.status(400).json({
        status: 'error',
        message: 'Event does not have a connected wallet. Please connect a wallet first.'
      });
    }

    // Begin transaction to create tickets
    const tickets = [];
    const currentDate = new Date().toISOString();

    for (let i = 1; i <= quantity; i++) {
      const ticketNumber = i;
      const ticketData = {
        event_id: event_id,
        ticket_status: 'valid',
        purchase_date: currentDate,
        ticket_number: ticketNumber,
        total_tickets_in_group: quantity,
        nft_mint_status: 'pending',
        nft_metadata: {
          name: `${ticket_name} #${ticketNumber}`,
          description: description || `Ticket for event: ${event.event_name}`,
          price: price || 0,
          image_url: image_url || '',
          ticket_type: ticket_type || 'standard',
          attributes: [
            {
              trait_type: 'Ticket Number',
              value: ticketNumber
            },
            {
              trait_type: 'Total Supply',
              value: quantity
            }
          ]
        }
      };

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert([ticketData])
        .select()
        .single();

      if (ticketError) {
        console.error('Error creating ticket:', ticketError);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to create tickets',
          error: ticketError.message
        });
      }

      tickets.push(ticket);
    }

    return res.status(200).json({
      status: 'success',
      message: `Successfully created ${quantity} tickets`,
      data: {
        event_id: event_id,
        tickets_created: tickets.length,
        tickets: tickets.map(ticket => ({
          ticket_id: ticket.ticket_id,
          ticket_number: ticket.ticket_number,
          nft_metadata: ticket.nft_metadata
        }))
      }
    });

  } catch (error) {
    console.error('Error creating tickets:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while creating tickets',
      error: error.message
    });
  }
}