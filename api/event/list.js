import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY  // Using anon key for public access
)

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*'); // Use '*' during testing, later restrict to your domain
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
    })
  }

  try {
    // Get query parameters for filtering
    const { upcoming, past, sort = 'event_date', order = 'asc' } = req.query

    // Start building the query
    let query = supabase
      .from('events')
      .select('*')

    // Apply filters based on query parameters
    if (upcoming === 'true') {
      query = query.gte('event_date', new Date().toISOString())
    } else if (past === 'true') {
      query = query.lt('event_date', new Date().toISOString())
    }

    // Apply sorting
    query = query.order(sort, { ascending: order === 'asc' })

    // Execute the query
    const { data: events, error: fetchError } = await query

    if (fetchError) {
      throw fetchError
    }

    return res.status(200).json({
      status: 'success',
      message: 'Events retrieved successfully',
      data: events
    })

  } catch (error) {
    console.error('Error fetching events:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching events',
      error: error.message
    })
  }
}