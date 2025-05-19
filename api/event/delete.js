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

  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
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

    // Get query parameters
    const { ticket_id, event_id } = req.query;
    
    if (!ticket_id && !event_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: either ticket_id or event_id'
      });
    }

    // If deleting a specific ticket, verify ownership
    if (ticket_id) {
      // Get ticket info
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('event_id, nft_mint_status, ticket_status')
        .eq('ticket_id', ticket_id)
        .single();

      if (ticketError || !ticket) {
        return res.status(404).json({
          status: 'error',
          message: 'Ticket not found'
        });
      }

      // Verify the user is an event admin for this ticket's event
      const { data: eventAdmin, error: eventAdminError } = await supabase
        .from('event_admins')
        .select('id, permission_level')
        .eq('auth_id', user.id)
        .eq('event_id', ticket.event_id)
        .single();

      if (eventAdminError || !eventAdmin) {
        return res.status(403).json({
          status: 'error',
          message: 'User is not authorized to manage tickets for this event'
        });
      }

      // Check if the ticket is already minted to the blockchain
      if (ticket.nft_mint_status === 'minted' || ticket.nft_mint_status === 'transferred') {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot delete ticket that has already been minted to the blockchain'
        });
      }

      // Delete the ticket
      const { error: deleteError } = await supabase
        .from('tickets')
        .delete()
        .eq('ticket_id', ticket_id);

      if (deleteError) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to delete ticket',
          error: deleteError.message
        });
      }

      return res.status(200).json({
        status: 'success',
        message: 'Ticket deleted successfully',
        data: { ticket_id }
      });
    }
    // If deleting all tickets for an event
    else if (event_id) {
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
          message: 'User is not authorized to manage tickets for this event'
        });
      }

      // Only delete tickets that haven't been minted yet
      const { data: deletedTickets, error: deleteError } = await supabase
        .from('tickets')
        .delete()
        .eq('event_id', event_id)
        .in('nft_mint_status', ['pending'])
        .select();

      if (deleteError) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to delete tickets',
          error: deleteError.message
        });
      }

      return res.status(200).json({
        status: 'success',
        message: `Successfully deleted ${deletedTickets.length} tickets`,
        data: {
          event_id,
          deleted_count: deletedTickets.length,
          deleted_tickets: deletedTickets.map(ticket => ticket.ticket_id)
        }
      });
    }

  } catch (error) {
    console.error('Error deleting tickets:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while deleting tickets',
      error: error.message
    });
  }
}