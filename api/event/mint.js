// /api/event/mint.js - Enhanced structure needed

import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    try {
        // 1. Authentication & Authorization
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        
        if (authError || !user) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Validate Event Admin Access
        const { data: eventAdmin } = await supabase
            .from('event_admins')
            .select('*, events(*)')
            .eq('auth_id', user.id)
            .eq('event_id', req.body.event_id)
            .single();

        if (!eventAdmin) {
            return res.status(403).json({ status: 'error', message: 'No access to this event' });
        }

        // 3. Validate Request Data
        const {
            event_id,
            ticket_name,
            quantity,
            price,
            ticket_type,
            description,
            image_url
        } = req.body;

        // Input validation
        if (!event_id || !ticket_name || !quantity || quantity < 1 || quantity > 1000) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Invalid input parameters' 
            });
        }

        // 4. Get Event & Wallet Info
        const { data: event } = await supabase
            .from('events')
            .select('*, admin_wallets(*)')
            .eq('event_id', event_id)
            .single();

        if (!event.nft_contract_address || !event.admin_wallets?.length) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Event not configured for NFT minting' 
            });
        }

        // 5. Generate Unique Ticket Numbers
        const { data: existingTickets } = await supabase
            .from('tickets')
            .select('ticket_number')
            .eq('event_id', event_id)
            .order('ticket_number', { ascending: false })
            .limit(1);

        const startingNumber = existingTickets?.length ? existingTickets[0].ticket_number + 1 : 1;

        // 6. Create Ticket Records in Database
        const ticketsToCreate = [];
        const nftMetadata = [];

        for (let i = 0; i < quantity; i++) {
            const ticketNumber = startingNumber + i;
            const ticketId = crypto.randomUUID();
            
            // Create database record
            ticketsToCreate.push({
                ticket_id: ticketId,
                event_id: event_id,
                ticket_number: ticketNumber,
                ticket_status: 'valid',
                nft_mint_status: 'pending',
                nft_contract_address: event.nft_contract_address,
                nft_token_id: null, // Will be set after minting
                nft_metadata: {
                    name: `${ticket_name} #${ticketNumber}`,
                    description: description,
                    image: image_url || `https://api.placeholder.com/400x300?text=${encodeURIComponent(ticket_name)}`,
                    attributes: [
                        { trait_type: "Event", value: event.event_name },
                        { trait_type: "Ticket Type", value: ticket_type },
                        { trait_type: "Ticket Number", value: ticketNumber },
                        { trait_type: "Price", value: `${price} ETH` },
                        { trait_type: "Total Supply", value: quantity }
                    ]
                },
                created_at: new Date().toISOString()
            });

            // Prepare NFT metadata for IPFS/blockchain
            nftMetadata.push({
                ticketId: ticketId,
                tokenId: ticketNumber, // or generate unique token ID
                metadata: {
                    name: `${ticket_name} #${ticketNumber}`,
                    description: description,
                    image: image_url || `https://api.placeholder.com/400x300?text=${encodeURIComponent(ticket_name)}`,
                    attributes: [
                        { trait_type: "Event", value: event.event_name },
                        { trait_type: "Ticket Type", value: ticket_type },
                        { trait_type: "Ticket Number", value: ticketNumber },
                        { trait_type: "Price", value: `${price} ETH` }
                    ]
                }
            });
        }

        // 7. Insert Tickets into Database
        const { data: createdTickets, error: dbError } = await supabase
            .from('tickets')
            .insert(ticketsToCreate)
            .select();

        if (dbError) {
            throw new Error(`Database error: ${dbError.message}`);
        }

        // 8. Queue for Blockchain Minting (Optional: Can be immediate or queued)
        if (process.env.IMMEDIATE_MINT === 'true') {
            await mintToBlockchain(nftMetadata, event.admin_wallets[0].wallet_address, event.nft_contract_address);
        } else {
            // Queue for background processing
            await queueForMinting(nftMetadata, event_id);
        }

        // 9. Return Success Response
        return res.status(201).json({
            status: 'success',
            message: `Successfully created ${quantity} ticket(s)`,
            data: {
                event_id: event_id,
                tickets_created: quantity,
                starting_ticket_number: startingNumber,
                tickets: createdTickets,
                mint_status: process.env.IMMEDIATE_MINT === 'true' ? 'minted' : 'queued'
            }
        });

    } catch (error) {
        console.error('Mint error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Minting failed',
            error: error.message
        });
    }
}

// Helper function for immediate blockchain minting
async function mintToBlockchain(nftMetadata, walletAddress, contractAddress) {
    try {
        // Set up blockchain connection
        const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
        const wallet = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
        
        // Contract ABI (simplified)
        const contractABI = [
            "function batchMint(address to, uint256[] tokenIds, string[] uris) external",
            "function mint(address to, uint256 tokenId, string uri) external"
        ];
        
        const contract = new ethers.Contract(contractAddress, contractABI, wallet);
        
        // Prepare batch minting data
        const tokenIds = nftMetadata.map(item => item.tokenId);
        const metadataURIs = await Promise.all(
            nftMetadata.map(item => uploadMetadataToIPFS(item.metadata))
        );
        
        // Execute batch mint
        const tx = await contract.batchMint(walletAddress, tokenIds, metadataURIs);
        await tx.wait();
        
        // Update database with successful mint
        for (let i = 0; i < nftMetadata.length; i++) {
            await supabase
                .from('tickets')
                .update({
                    nft_mint_status: 'minted',
                    nft_token_id: tokenIds[i]
                })
                .eq('ticket_id', nftMetadata[i].ticketId);
        }
        
        return true;
    } catch (error) {
        console.error('Blockchain minting error:', error);
        // Update failed tickets
        for (const item of nftMetadata) {
            await supabase
                .from('tickets')
                .update({ nft_mint_status: 'failed' })
                .eq('ticket_id', item.ticketId);
        }
        throw error;
    }
}

// Helper function to queue minting for background processing
async function queueForMinting(nftMetadata, eventId) {
    const { error } = await supabase
        .from('mint_queue')
        .insert({
            event_id: eventId,
            ticket_data: nftMetadata,
            status: 'pending',
            created_at: new Date().toISOString()
        });
    
    if (error) {
        throw new Error(`Queue error: ${error.message}`);
    }
}

// Helper function to upload metadata to IPFS (you'll need to implement this)
async function uploadMetadataToIPFS(metadata) {
    // Use services like Pinata, Infura IPFS, or your own IPFS node
    // For now, return a placeholder
    return `https://ipfs.io/ipfs/placeholder-${Date.now()}`;
}