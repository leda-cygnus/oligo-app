'use strict'

// Uppercase alphanumeric excluding ambiguous chars: 0 (zero), O, 1 (one), I
// 24 letters + 8 digits = 32 chars → 32^5 = 33,554,432 possible suffixes
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomSuffix() {
  let s = ''
  for (let i = 0; i < 5; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]
  return s
}

function buildDisplayId(type, year, suffix) {
  const prefix = type === 'quote' ? 'Q' : 'SO'
  return `${prefix}-${year}-${suffix}`
}

// Returns { displayId, internalSeq } for the given type ('quote' | 'order').
// Checks uniqueness across both quote and sales_order tables before returning.
// Requires an active pg client (called within a transaction).
async function generateId(type, client) {
  if (type !== 'quote' && type !== 'order') throw new Error(`Unknown id type: ${type}`)
  const counterKey = type === 'quote' ? 'quote' : 'sales_order'
  const year = new Date().getFullYear()

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = randomSuffix()
    const displayId = buildDisplayId(type, year, suffix)

    const [qHit, soHit] = await Promise.all([
      client.query('SELECT 1 FROM quote       WHERE display_id = $1', [displayId]),
      client.query('SELECT 1 FROM sales_order WHERE display_id = $1', [displayId]),
    ])

    if (qHit.rows.length === 0 && soHit.rows.length === 0) {
      // Atomically claim the next internal sequence number
      const seqRes = await client.query(
        `UPDATE id_counter SET next_val = next_val + 1
         WHERE type = $1
         RETURNING next_val - 1 AS seq`,
        [counterKey]
      )
      return { displayId, internalSeq: seqRes.rows[0].seq }
    }
  }

  throw new Error(`Could not generate unique ${type} ID after 100 attempts`)
}

// Creates a sales_order row whose display_id shares the 5-char suffix of the source quote.
// Updates the quote status to 'converted'.
// Must be called inside a BEGIN/COMMIT block.
async function convertQuoteToOrder(quoteId, client) {
  const qr = await client.query(
    'SELECT id, display_id FROM quote WHERE id = $1',
    [quoteId]
  )
  if (!qr.rows.length) throw new Error(`Quote ${quoteId} not found`)

  const quoteDisplayId = qr.rows[0].display_id
  if (!quoteDisplayId) throw new Error(`Quote ${quoteId} has no display_id assigned`)

  // Q-2026-K4M9R → parts[0]='Q', parts[1]='2026', parts[2]='K4M9R'
  const parts = quoteDisplayId.split('-')
  if (parts.length !== 3) throw new Error(`Unexpected display_id format: ${quoteDisplayId}`)
  const [, year, suffix] = parts
  const soDisplayId = `SO-${year}-${suffix}`

  // Claim internal seq for sales_order
  const seqRes = await client.query(
    `UPDATE id_counter SET next_val = next_val + 1
     WHERE type = 'sales_order'
     RETURNING next_val - 1 AS seq`
  )
  const internalSeq = seqRes.rows[0].seq

  const insert = await client.query(
    `INSERT INTO sales_order (display_id, internal_seq, quote_id, status)
     VALUES ($1, $2, $3, 'confirmed')
     RETURNING id, display_id, internal_seq`,
    [soDisplayId, internalSeq, quoteId]
  )

  await client.query(
    `UPDATE quote SET status = 'converted', updated_at = NOW() WHERE id = $1`,
    [quoteId]
  )

  return insert.rows[0]
}

module.exports = { generateId, convertQuoteToOrder, buildDisplayId, randomSuffix, CHARS }
