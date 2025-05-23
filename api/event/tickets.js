// /api/event/tickets.js - Get tickets for an event
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    try {
        const { event_id } = req.query;
        
        const { data: tickets, error } = await supabase
            .from('tickets')
            .select(`
                *,
                events!inner(event_name, event_date)
            `)
            .eq('event_id', event_id)
            .order('ticket_number', { ascending: true });

        if (error) throw error;

        return res.status(200).json({
            status: 'success',
            data: tickets || []
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

// /api/event/mint-status.js - Check minting status
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    try {
        const { event_id } = req.query;
        
        // Get mint queue status
        const { data: queueStatus } = await supabase
            .from('mint_queue')
            .select('status, created_at, processed_at, error_message')
            .eq('event_id', event_id)
            .order('created_at', { ascending: false });

        // Get ticket minting status
        const { data: ticketStatus } = await supabase
            .from('tickets')
            .select('nft_mint_status')
            .eq('event_id', event_id);

        const summary = {
            total_tickets: ticketStatus?.length || 0,
            minted: ticketStatus?.filter(t => t.nft_mint_status === 'minted').length || 0,
            pending: ticketStatus?.filter(t => t.nft_mint_status === 'pending').length || 0,
            failed: ticketStatus?.filter(t => t.nft_mint_status === 'failed').length || 0,
            queue_jobs: queueStatus || []
        };

        return res.status(200).json({
            status: 'success',
            data: summary
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}

// /api/event/retry-mint.js - Retry failed mint jobs
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    try {
        const { event_id } = req.body;
        
        // Reset failed mint jobs
        const { error } = await supabase
            .from('mint_queue')
            .update({ 
                status: 'pending',
                retry_count: 0,
                error_message: null
            })
            .eq('event_id', event_id)
            .eq('status', 'failed');

        if (error) throw error;

        return res.status(200).json({
            status: 'success',
            message: 'Failed mint jobs queued for retry'
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
}