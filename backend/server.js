require('dotenv').config()
const express = require('express')
const { Pool } = require('pg')
const cors = require('cors')
const multer = require('multer')
const AdmZip = require('adm-zip')
const crypto = require('crypto')
const { generateId, convertQuoteToOrder } = require('./idgen')
const { Document, Packer, Paragraph, TextRun, PageBreak,
        BorderStyle, WidthType, ShadingType,
        Table, TableRow, TableCell, AlignmentType, ImageRun,
        VerticalAlign, HeightRule } = require('docx')
const fs = require('fs')

let logoBuffer = null
try { logoBuffer = fs.readFileSync('./logo.png') } catch (_) {}

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3001
const DB_HOST = process.env.DB_HOST || 'localhost'
const DB_PORT = process.env.DB_PORT || 5432
const DB_NAME = process.env.DB_NAME || 'oligosynth'

function getPool(req, res) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Basic ')) {
    res.status(401).json({ error: 'Not logged in' })
    return null
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':')
  return new Pool({
    host: DB_HOST, port: DB_PORT, database: DB_NAME,
    user, password: pass, max: 3, connectionTimeoutMillis: 4000
  })
}

async function withDb(req, res, fn) {
  const pool = getPool(req, res)
  if (!pool) return
  let client
  try {
    client = await pool.connect()
    await fn(client)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Database error' })
  } finally {
    if (client) client.release()
    await pool.end()
  }
}

// GET /api/modifications
app.get('/api/modifications', async (req, res) => {
  await withDb(req, res, async (client) => {
    const result = await client.query(
      'SELECT * FROM modification_catalog ORDER BY canonical_name'
    )
    res.json(result.rows)
  })
})

// POST /api/modifications
app.post('/api/modifications', async (req, res) => {
  const { canonical_name, aliases, chemistry_class, end_5prime_ok,
          end_3prime_ok, internal_ok, machine_position_required, description } = req.body
  await withDb(req, res, async (client) => {
    await client.query(
      `INSERT INTO modification_catalog
         (canonical_name, aliases, chemistry_class, end_5prime_ok, end_3prime_ok,
          internal_ok, machine_position_required, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [canonical_name, aliases, chemistry_class, end_5prime_ok,
       end_3prime_ok, internal_ok, machine_position_required, description]
    )
    res.json({ ok: true })
  })
})

// parse_idt_sequence returns modifications as a PostgreSQL composite array:
// {"(raw_token,position_type,after_nt_index,display_order,canonical_name,mod_id,resolved)",...}
function parseModArray(str) {
  if (!str) return []
  const inner = str.slice(1, -1)
  if (!inner.trim()) return []
  const elements = []
  let i = 0
  while (i < inner.length) {
    if (inner[i] === '"') {
      let j = i + 1
      while (j < inner.length && !(inner[j] === '"' && inner[j - 1] !== '\\')) j++
      elements.push(inner.slice(i + 1, j))
      i = j + 2
    } else if (inner[i] === '(') {
      const j = inner.indexOf(')', i)
      elements.push(inner.slice(i, j + 1))
      i = j + 2
    } else {
      i++
    }
  }
  return elements.map(e => {
    const parts = (e.startsWith('(') ? e.slice(1, -1) : e).split(',')
    return {
      raw_token:       parts[0] || null,
      position_type:   parts[1] || null,
      after_nt_index:  parts[2] ? parseInt(parts[2]) : null,
      display_order:   parts[3] ? parseInt(parts[3]) : null,
      canonical_name:  parts[4] || null,
      modification_id: parts[5] || null,
      resolved:        parts[6] === 't',
    }
  })
}

// POST /api/parse
app.post('/api/parse', async (req, res) => {
  const { sequence } = req.body
  if (!sequence) return res.status(400).json({ error: 'sequence required' })
  await withDb(req, res, async (client) => {
    const result = await client.query('SELECT * FROM parse_idt_sequence($1)', [sequence])
    if (!result.rows.length) return res.json({ clean_bases: '', modifications: [], has_errors: false })
    const row = result.rows[0]
    res.json({
      clean_bases:   row.clean_bases,
      oligo_type:    row.oligo_type,
      has_errors:    row.has_errors,
      error_detail:  row.error_detail,
      modifications: parseModArray(row.modifications),
    })
  })
})

// Stable hash of an order's oligo list — used for duplicate detection.
function computeParsedHash(oligos) {
  const normalized = JSON.stringify(
    [...oligos]
      .sort((a, b) => a.sequence.localeCompare(b.sequence))
      .map(o => ({ name: o.name, sequence: o.sequence, scale_nmol: o.scale_nmol }))
  )
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32)
}

// Molecular weight of a single-stranded oligo from its clean base string.
// Formula: OligoCalc/IDT convention (free acid, 5'-OH terminus).
// DNA: (nA×313.21)+(nC×289.18)+(nG×329.21)+(nT×304.19)−61.96
// RNA: (nA×329.21)+(nC×305.18)+(nG×345.21)+(nU×306.17)−61.96
function calcMolWeight(bases, oligoType) {
  if (!bases) return null
  const weights = (oligoType || '').toUpperCase() === 'RNA'
    ? { A: 329.21, C: 305.18, G: 345.21, U: 306.17 }
    : { A: 313.21, C: 289.18, G: 329.21, T: 304.19 }
  let mw = -61.96
  for (const ch of bases.toUpperCase()) {
    if (weights[ch] !== undefined) mw += weights[ch]
  }
  return Math.round(mw * 100) / 100
}

// Apply mod-position substitutions to an annotated sequence string.
// modSubs: [{ canonical_name, aliases, synth_slot }]
// Replaces /5Name/ /iName/ /3Name/ (and aliases) with the slot number.
function applyModSubstitutions(seq, modSubs) {
  let result = (seq || '').replace(/\s/g, '')
  for (const sub of modSubs) {
    const names = [
      sub.canonical_name,
      ...(sub.aliases ? String(sub.aliases).split(',').map(a => a.trim()).filter(Boolean) : []),
    ]
    for (const name of names) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(`\\/[5i3]?${esc}\\/`, 'g'), String(sub.synth_slot))
    }
  }
  return result
}

// After reagents are committed: recalculate calc_mw for every line in the run.
// backbone MW (OligoCalc formula) + per-modification mw_addition from the chosen material lot.
async function recalcRunMws(client, runId) {
  const modMapRes = await client.query(`
    SELECT mc.canonical_name, ml.mw_addition
    FROM synthesis_run_mod_map smm
    JOIN modification_catalog mc ON mc.id = smm.modification_id
    LEFT JOIN material_lot ml ON ml.id = smm.material_lot_id
    WHERE smm.run_id = $1
  `, [runId])
  const modMwMap = {}
  for (const r of modMapRes.rows)
    modMwMap[r.canonical_name] = parseFloat(r.mw_addition) || 0

  const linesRes = await client.query(`
    SELECT srl.id, s.tokens
    FROM synthesis_run_line srl
    JOIN order_line ol ON ol.id = srl.order_line_id
    JOIN sequence s ON s.id = ol.sequence_id
    WHERE srl.run_id = $1
  `, [runId])

  for (const line of linesRes.rows) {
    if (!line.tokens) continue
    const tokens = typeof line.tokens === 'string' ? JSON.parse(line.tokens) : line.tokens
    let mw = calcMolWeight(tokens.bases || '', tokens.oligo_type || 'DNA')
    if (mw === null) continue
    for (const mod of (tokens.modifications || []))
      if (mod.canonical_name && modMwMap[mod.canonical_name] !== undefined)
        mw += modMwMap[mod.canonical_name]
    await client.query('UPDATE synthesis_run_line SET calc_mw = $1 WHERE id = $2',
      [Math.round(mw * 100) / 100, line.id])
  }
}

// Build a tokens JSONB object from a parse_idt_sequence result row.
function buildTokens(parseRow) {
  if (!parseRow) return null
  return {
    bases:         parseRow.clean_bases,
    oligo_type:    parseRow.oligo_type,
    modifications: parseModArray(parseRow.modifications),
  }
}

// POST /api/sequences
app.post('/api/sequences', async (req, res) => {
  const { sequence } = req.body
  if (!sequence) return res.status(400).json({ error: 'sequence required' })
  await withDb(req, res, async (client) => {
    const parseResult = await client.query('SELECT * FROM parse_idt_sequence($1)', [sequence])
    const tokens = buildTokens(parseResult.rows[0])

    const result = await client.query('SELECT insert_idt_sequence($1) AS id', [sequence])
    const id = result.rows[0].id

    const mw = tokens ? calcMolWeight(tokens.bases, tokens.oligo_type) : null
    await client.query(
      'UPDATE sequence SET raw_idt = $1, tokens = $2, mol_weight = $3 WHERE id = $4',
      [sequence, tokens ? JSON.stringify(tokens) : null, mw, id]
    )
    res.json({ id })
  })
})

// GET /api/sequences
app.get('/api/sequences', async (req, res) => {
  await withDb(req, res, async (client) => {
    const result = await client.query(`
      SELECT v.*,
             s.name                                   AS oligo_name,
             to_char(s.created_at, 'YYYY-MM-DD HH24:MI:SS') AS order_date,
             o.customer_ref                           AS order_number,
             o.id                                     AS order_id
      FROM   v_annotated_sequence v
      LEFT JOIN sequence s ON s.id = v.sequence_id
      LEFT JOIN "order" o  ON o.id = s.order_id
      ORDER BY v.sequence_id
    `)
    res.json(result.rows)
  })
})

// GET /api/orders
app.get('/api/orders', async (req, res) => {
  await withDb(req, res, async (client) => {
    const result = await client.query(`
      SELECT o.id,
             o.customer_ref,
             o.customer_name,
             o.customer_email,
             o.customer_id,
             o.source,
             o.status,
             c.company_name AS institute,
             c.street       AS customer_address,
             to_char(MIN(s.created_at), 'YYYY-MM-DD') AS order_date,
             COUNT(ol.id)                              AS line_count,
             (
               SELECT sr.id
               FROM synthesis_run_line srl2
               JOIN order_line ol2 ON ol2.id = srl2.order_line_id
               JOIN synthesis_run sr ON sr.id = srl2.run_id
               WHERE ol2.order_id = o.id
                 AND sr.started_at IS NOT NULL
               ORDER BY sr.started_at DESC
               LIMIT 1
             ) AS active_run_id
      FROM   "order" o
      LEFT JOIN customer c   ON c.id = o.customer_id
      LEFT JOIN order_line ol ON ol.order_id = o.id
      LEFT JOIN sequence s   ON s.id = ol.sequence_id
      GROUP BY o.id, c.company_name, c.street
      ORDER BY MIN(s.created_at) DESC NULLS LAST
    `)
    res.json(result.rows)
  })
})

// GET /api/orders/:id
app.get('/api/orders/:id', async (req, res) => {
  await withDb(req, res, async (client) => {
    const orderRes = await client.query('SELECT * FROM "order" WHERE id = $1', [req.params.id])
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Not found' })

    const linesRes = await client.query(`
      SELECT ol.id, ol.line_number, ol.customer_label, ol.quantity_nmol, ol.notes, ol.researcher,
             s.id                AS sequence_id,
             s.name              AS oligo_name,
             s.tokens,
             v.annotated_sequence,
             v.oligo_type,
             v.length_nt,
             CASE
               -- Failed and re-queued in a newer run → queued for resynthesis
               WHEN EXISTS (
                 SELECT 1 FROM synthesis_run_line srl
                 JOIN  synthesis_run sr ON sr.id = srl.run_id
                 WHERE srl.order_line_id = ol.id AND sr.started_at IS NOT NULL AND srl.status = 'failed'
               ) AND EXISTS (
                 SELECT 1 FROM synthesis_run_line srl2
                 JOIN  synthesis_run sr2 ON sr2.id = srl2.run_id
                 WHERE srl2.order_line_id = ol.id
                   AND (sr2.started_at IS NULL OR (sr2.started_at IS NOT NULL AND srl2.status = 'pending'))
               ) THEN 'queued_resynthesis'
               -- Failed with no new run
               WHEN EXISTS (
                 SELECT 1 FROM synthesis_run_line srl
                 JOIN  synthesis_run sr ON sr.id = srl.run_id
                 WHERE srl.order_line_id = ol.id AND sr.started_at IS NOT NULL AND srl.status = 'failed'
               ) THEN 'failed'
               -- Synthesized successfully
               WHEN EXISTS (
                 SELECT 1 FROM synthesis_run_line srl
                 JOIN  synthesis_run sr ON sr.id = srl.run_id
                 WHERE srl.order_line_id = ol.id AND sr.started_at IS NOT NULL AND srl.status = 'synthesized'
               ) THEN 'finished'
               -- In a started run, pending result
               WHEN EXISTS (
                 SELECT 1 FROM synthesis_run_line srl
                 JOIN  synthesis_run sr ON sr.id = srl.run_id
                 WHERE srl.order_line_id = ol.id AND sr.started_at IS NOT NULL AND srl.status = 'pending'
               ) THEN 'in_progress'
               -- In a queued (not yet started) run
               WHEN EXISTS (
                 SELECT 1 FROM synthesis_run_line srl
                 JOIN  synthesis_run sr ON sr.id = srl.run_id
                 WHERE srl.order_line_id = ol.id AND sr.started_at IS NULL
               ) THEN 'queued'
               ELSE NULL
             END AS line_status
      FROM   order_line ol
      JOIN   sequence s              ON s.id = ol.sequence_id
      LEFT JOIN v_annotated_sequence v ON v.sequence_id = s.id
      WHERE  ol.order_id = $1
      ORDER  BY ol.line_number
    `, [req.params.id])

    res.json({ ...orderRes.rows[0], lines: linesRes.rows })
  })
})

// GET /api/customers
app.get('/api/customers', async (req, res) => {
  await withDb(req, res, async (client) => {
    const result = await client.query(`
      SELECT c.id, c.contact_name, c.company_name, c.email,
             c.building_name, c.lab, c.street, c.city, c.zip, c.phone,
             COUNT(o.id)::int AS order_count
      FROM customer c
      LEFT JOIN "order" o ON o.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.company_name NULLS LAST, c.contact_name NULLS LAST
    `)
    res.json(result.rows)
  })
})

// PUT /api/customers/:id
app.put('/api/customers/:id', async (req, res) => {
  const { contact_name, company_name, email, building_name, lab, street, city, zip, phone } = req.body
  await withDb(req, res, async (client) => {
    const r = await client.query(
      `UPDATE customer
         SET contact_name=$1, company_name=$2, email=$3,
             building_name=$4, lab=$5, street=$6, city=$7, zip=$8, phone=$9
       WHERE id=$10 RETURNING *`,
      [contact_name || null, company_name || null, email || null,
       building_name || null, lab || null, street || null, city || null, zip || null, phone || null,
       req.params.id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Customer not found' })
    res.json(r.rows[0])
  })
})

// PUT /api/orders/:id/customer — edit order number, customer name, institute, email
app.put('/api/orders/:id/customer', async (req, res) => {
  const { customer_ref, customer_name, institute, email } = req.body
  await withDb(req, res, async (client) => {
    const orderRes = await client.query('SELECT customer_id FROM "order" WHERE id = $1', [req.params.id])
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found' })
    const customerId = orderRes.rows[0].customer_id
    if (customerId) {
      await client.query(
        'UPDATE customer SET contact_name = $1, company_name = $2, email = $3 WHERE id = $4',
        [customer_name || null, institute || null, email || null, customerId]
      )
    }
    await client.query(
      'UPDATE "order" SET customer_ref = $1, customer_name = $2, customer_email = $3 WHERE id = $4',
      [customer_ref || null, customer_name || null, email || null, req.params.id]
    )
    res.json({ ok: true })
  })
})

// DELETE /api/orders/:id — blocked if order has lines in any run
app.delete('/api/orders/:id', async (req, res) => {
  await withDb(req, res, async (client) => {
    const runCheck = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM synthesis_run_line srl
      JOIN order_line ol ON ol.id = srl.order_line_id
      WHERE ol.order_id = $1
    `, [req.params.id])
    if (runCheck.rows[0].cnt > 0)
      return res.status(409).json({ error: 'This order is part of an existing run and cannot be deleted.' })
    await client.query('BEGIN')
    try {
      await client.query('DELETE FROM order_line WHERE order_id = $1', [req.params.id])
      await client.query('DELETE FROM "order" WHERE id = $1', [req.params.id])
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// ── Order import ─────────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

function extractDocxText(buffer) {
  const zip = new AdmZip(buffer)
  const entry = zip.getEntry('word/document.xml')
  if (!entry) throw new Error('Not a valid docx file')
  const xml = entry.getData().toString('utf8')
  const texts = []
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) texts.push(m[1])
  }
  return texts.join(' ')
}

function parseOrderText(raw) {
  const t = raw.replace(/\s+/g, ' ').trim()

  const orderRefMatch = t.match(/[Oo]rder\s*[:#]?\s*#(\d+)/)
  const customerMatch     = t.match(/new order from ([^:]+):/i)
  const billingNameMatch  = t.match(/Billing address ([A-Z][a-z]+ [A-Z][a-z]+)/)
  const billingAddrMatch  = t.match(/Billing address [A-Z][a-z]+ [A-Z][a-z]+ (.+?)(?= (?:Phone|Email|Fax|VAT|Synthesized|Total|Payment)|\s*$)/i)
  const instituteMatch    = t.match(/University\s*\/\s*Company:\s*(.+?)\s+(?:PI:|Lab Manager:|Billing address)/i)
  const dateMatch         = t.match(/Order\s+#\d+\s*\(([^)]+)\)/)
  // Exclude the company's own address (footer); take the last remaining email (customer's)
  const allEmails     = [...t.matchAll(/[\w.+\-]+@[\w\-]+\.[\w]+(?:\.[\w]+)*/g)]
  const ownDomain = (process.env.COMPANY_DOMAIN || '').toLowerCase()
  const customerEmails = allEmails.filter(m => !ownDomain || !m[0].toLowerCase().includes(ownDomain))
  const emailMatch    = customerEmails.length ? customerEmails[customerEmails.length - 1] : (allEmails.length ? allEmails[allEmails.length - 1] : null)

  // Each line-item ends with price + ₪. Split on ₪ to isolate items cleanly.
  const oligos = []
  const chunks = t.split('₪') // ₪
  for (const chunk of chunks) {
    const pipeIdx = chunk.indexOf('|')
    if (pipeIdx < 0) continue

    // Must contain "| Sequence:"
    const seqMatch = chunk.match(/\|\s*Sequence:\s*([A-Za-z]+)\s*\|(.+)/)
    if (!seqMatch) continue

    // Parse variable-length pipe fields: scale | purif | [optional notes…] | formulation
    const fields = seqMatch[2].split('|').map(f => f.trim()).filter(Boolean)
    if (fields.length < 2) continue
    const scaleMatch  = fields[0].match(/([\d.]+)\s*nmol/)
    const scale_nmol  = scaleMatch ? parseInt(scaleMatch[1]) : null
    const purification = fields[1] || null
    // Last field is "Dry Researcher: …" — strip everything from "Researcher:" onward
    const lastField      = fields[fields.length - 1] || ''
    const resMatch       = lastField.match(/Researcher:\s*(.+)/i)
    const researcher     = resMatch ? resMatch[1].trim() : null
    const formulation    = lastField.split(/\s+Researcher:/i)[0].trim()
    // Fields between purification and formulation are extra product info (e.g. 5' Mod)
    const extraFields        = fields.slice(2, fields.length - 1)
    const modification_notes = extraFields.length ? extraFields.join(', ') : null

    // Name + type sit before the first "|"
    // No \b — handles fused format like "loc_0_4bpDNA" (no space before DNA/RNA)
    const before    = chunk.slice(0, pipeIdx).trim()
    const typeMatch = before.match(/(DNA|RNA)\s*$/)
    if (!typeMatch) continue

    let nameSrc = before.slice(0, typeMatch.index).trim()
    // Strip order preamble — header ends at the last ")" e.g. "(April 13, 2026)"
    const lastParen = nameSrc.lastIndexOf(')')
    if (lastParen >= 0) nameSrc = nameSrc.slice(lastParen + 1)

    oligos.push({
      name:               nameSrc.trim().replace(/^#\d+\s+/, '').replace(/\s+/g, ' '),
      oligo_type:         typeMatch[1],
      sequence:           seqMatch[1].trim(),
      scale_nmol,
      purification,
      formulation,
      modification_notes,
      researcher,
    })
  }

  return {
    order_ref:      orderRefMatch ? orderRefMatch[1] : null,
    customer_name:  (billingNameMatch || customerMatch) ? (billingNameMatch || customerMatch)[1].trim() : null,
    customer_email: emailMatch    ? emailMatch[0]            : null,
    institute:      instituteMatch ? instituteMatch[1].trim() : null,
    address:        billingAddrMatch ? billingAddrMatch[1].trim() : null,
    order_date:     dateMatch     ? dateMatch[1].trim()     : null,
    oligos,
  }
}

// POST /api/orders/parse-text
app.post('/api/orders/parse-text', (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })
  try {
    res.json({ ...parseOrderText(text), raw_text: text })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/orders/parse-docx
app.post('/api/orders/parse-docx', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' })
  try {
    const text = extractDocxText(req.file.buffer)
    res.json({ ...parseOrderText(text), raw_text: text })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Build IDT-notation string from modification_notes.
// e.g. "5' Mod: 5' Phosphorylation" + "ACGT" -> "/5Phos/ACGT"
async function buildIdtString(client, sequence, modNotes) {
  if (!modNotes) return sequence

  let prefix = '', suffix = ''
  for (const part of modNotes.split(',')) {
    const p = part.trim()

    // Determine position from the leading digit
    let pos = null
    if (/^5/.test(p))        pos = '5prime'
    else if (/^3/.test(p))  pos = '3prime'
    else if (/internal/i.test(p)) pos = 'internal'
    if (!pos) continue

    // Extract mod name: everything after the last ":" (e.g. "5' Mod: 5' Phosphorylation" -> "Phosphorylation")
    const colonIdx = p.lastIndexOf(':')
    let modName = (colonIdx >= 0 ? p.slice(colonIdx + 1) : p).trim()
    // Strip any leading position prefix ("5' ", "3' ", etc.)
    modName = modName.replace(/^[53]\S?\s*/i, '').trim()
    if (!modName) continue

    // Find catalog entry by canonical name or any alias (case-insensitive)
    const r = await client.query(`
      SELECT aliases FROM modification_catalog
      WHERE canonical_name ILIKE $1
         OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE $1)
      LIMIT 1
    `, [modName])
    if (!r.rows.length) continue

    // Pick the alias starting with the position character: "5xxx" / "3xxx" / "ixxx"
    const aliases = r.rows[0].aliases || []
    const prefixChar = pos === '5prime' ? '5' : pos === '3prime' ? '3' : 'i'
    const token = aliases.find(a => a.startsWith(prefixChar)) || aliases[0]
    if (!token) continue

    if (pos === '5prime')      prefix = `/${token}/`
    else if (pos === '3prime') suffix = `/${token}/`
  }

  return prefix + sequence + suffix
}

// POST /api/orders
app.post('/api/orders', async (req, res) => {
  const { parsed, source } = req.body
  if (!parsed?.oligos?.length) return res.status(400).json({ error: 'parsed order data required' })

  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      // ── 3. Duplicate detection ──────────────────────────────────────────────
      const parsedHash = computeParsedHash(parsed.oligos)
      const dupCheck = await client.query(
        'SELECT id FROM "order" WHERE parsed_hash = $1',
        [parsedHash]
      )
      if (dupCheck.rows.length) {
        await client.query('ROLLBACK')
        return res.status(409).json({
          error: `Duplicate order — already imported as order #${dupCheck.rows[0].id}`
        })
      }

      // ── 1. Customer lookup / create ─────────────────────────────────────────
      let customerId = null
      if (parsed.customer_email) {
        const custLookup = await client.query(
          'SELECT id FROM customer WHERE lower(email) = lower($1)',
          [parsed.customer_email]
        )
        if (custLookup.rows.length) {
          customerId = custLookup.rows[0].id
          await client.query(
            `UPDATE customer SET
               contact_name = COALESCE(NULLIF(contact_name, ''), $1),
               company_name = COALESCE(NULLIF(company_name, ''), $2),
               street       = COALESCE(NULLIF(street, ''), $3)
             WHERE id = $4`,
            [parsed.customer_name || null, parsed.institute || null, parsed.address || null, customerId]
          )
        } else {
          const newCust = await client.query(
            'INSERT INTO customer (contact_name, company_name, email, street) VALUES ($1, $2, $3, $4) RETURNING id',
            [parsed.customer_name || null, parsed.institute || null, parsed.customer_email, parsed.address || null]
          )
          customerId = newCust.rows[0].id
        }
      }

      const orderResult = await client.query(
        `INSERT INTO "order" (source, raw_input, customer_ref, customer_name, customer_email,
           customer_id, target_chemistry, status, parsed_hash)
         VALUES ($1, $2, $3, $4, $5, $6, 'standard', 'received', $7) RETURNING id`,
        [source || 'website', parsed.raw_text || '', parsed.order_ref,
         parsed.customer_name, parsed.customer_email, customerId, parsedHash]
      )
      const orderId = orderResult.rows[0].id

      for (let i = 0; i < parsed.oligos.length; i++) {
        const o = parsed.oligos[i]

        const idtStr = await buildIdtString(client, o.sequence, o.modification_notes)

        // ── 5. Parse for tokens before inserting ───────────────────────────
        const parseResult = await client.query('SELECT * FROM parse_idt_sequence($1)', [idtStr])
        const tokens = buildTokens(parseResult.rows[0])

        const seqResult = await client.query('SELECT insert_idt_sequence($1) AS id', [idtStr])
        const seqId = seqResult.rows[0].id

        const mw = tokens ? calcMolWeight(tokens.bases, tokens.oligo_type) : null
        await client.query(
          'UPDATE sequence SET name = $1, order_id = $2, raw_idt = $3, tokens = $4, mol_weight = $5 WHERE id = $6',
          [o.name || null, orderId, idtStr, tokens ? JSON.stringify(tokens) : null, mw, seqId]
        )

        const noteParts = [`Purification: ${o.purification}`]
        if (o.modification_notes) noteParts.push(`Modification: ${o.modification_notes}`)
        noteParts.push(`Formulation: ${o.formulation}`)
        await client.query(
          `INSERT INTO order_line (order_id, sequence_id, customer_label, quantity_nmol,
             priority, line_number, notes, researcher)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [orderId, seqId, o.name, o.scale_nmol, i + 1, i + 1, noteParts.join(', '), o.researcher || null]
        )
      }

      await client.query('COMMIT')
      res.json({ order_id: orderId, line_count: parsed.oligos.length })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// ── Material lots ─────────────────────────────────────────────────────────────

// GET /api/material-lots
app.get('/api/material-lots', async (req, res) => {
  await withDb(req, res, async (client) => {
    const result = await client.query(`
      SELECT id, material_type, canonical_name, catalogue_number, lot_number,
             manufacturer, vendor, mw, fw,
             to_char(received_date, 'YYYY-MM-DD') AS received_date,
             to_char(expiry_date,  'YYYY-MM-DD') AS expiry_date
      FROM material_lot
      ORDER BY material_type, canonical_name, created_at DESC
    `)
    res.json(result.rows)
  })
})

// POST /api/material-lots
app.post('/api/material-lots', async (req, res) => {
  const { material_type, canonical_name, catalogue_number, lot_number,
          manufacturer, vendor, mw, fw, received_date, expiry_date } = req.body
  if (!material_type || !lot_number)
    return res.status(400).json({ error: 'material_type and lot_number required' })
  await withDb(req, res, async (client) => {
    const r = await client.query(`
      INSERT INTO material_lot
        (material_type, canonical_name, catalogue_number, lot_number,
         manufacturer, vendor, mw, fw, received_date, expiry_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, material_type, canonical_name, catalogue_number, lot_number,
        manufacturer, vendor, mw, fw,
        to_char(received_date, 'YYYY-MM-DD') AS received_date,
        to_char(expiry_date,  'YYYY-MM-DD') AS expiry_date
    `, [material_type, canonical_name || null, catalogue_number || null, lot_number,
        manufacturer || null, vendor || null,
        mw || null, fw || null,
        received_date || null, expiry_date || null])
    res.json(r.rows[0])
  })
})

// PUT /api/material-lots/:id
app.put('/api/material-lots/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'invalid id' })
  const { material_type, canonical_name, catalogue_number, lot_number,
          manufacturer, vendor, mw, fw, received_date, expiry_date } = req.body
  if (!material_type || !lot_number)
    return res.status(400).json({ error: 'material_type and lot_number required' })
  await withDb(req, res, async (client) => {
    const r = await client.query(`
      UPDATE material_lot SET
        material_type    = $1,
        canonical_name   = $2,
        catalogue_number = $3,
        lot_number       = $4,
        manufacturer     = $5,
        vendor           = $6,
        mw               = $7,
        fw               = $8,
        received_date    = $9,
        expiry_date      = $10
      WHERE id = $11
      RETURNING id, material_type, canonical_name, catalogue_number, lot_number,
        manufacturer, vendor, mw, fw,
        to_char(received_date, 'YYYY-MM-DD') AS received_date,
        to_char(expiry_date,  'YYYY-MM-DD') AS expiry_date
    `, [material_type, canonical_name || null, catalogue_number || null, lot_number,
        manufacturer || null, vendor || null,
        mw || null, fw || null,
        received_date || null, expiry_date || null,
        id])
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(r.rows[0])
  })
})

// DELETE /api/material-lots/:id
app.delete('/api/material-lots/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).json({ error: 'invalid id' })
  await withDb(req, res, async (client) => {
    await client.query('DELETE FROM material_lot WHERE id = $1', [id])
    res.json({ ok: true })
  })
})

// GET /api/runs
app.get('/api/runs', async (req, res) => {
  await withDb(req, res, async (client) => {
    const result = await client.query(`
      SELECT
        sr.id,
        sr.synthesizer,
        sr.operator,
        sr.scale_nmol,
        sr.notes,
        sr.started_at,
        to_char(sr.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_date,
        COUNT(srl.id)::int AS well_count,
        array_agg(DISTINCT o.customer_ref ORDER BY o.customer_ref) FILTER (WHERE o.customer_ref IS NOT NULL) AS order_refs
      FROM synthesis_run sr
      LEFT JOIN synthesis_run_line srl ON srl.run_id = sr.id
      LEFT JOIN order_line ol ON ol.id = srl.order_line_id
      LEFT JOIN "order" o ON o.id = ol.order_id
      GROUP BY sr.id
      ORDER BY sr.created_at DESC
    `)
    res.json(result.rows)
  })
})

// GET /api/runs/:id — run detail with all wells
app.get('/api/runs/:id', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })

  await withDb(req, res, async (client) => {
    const runRes = await client.query(`
      SELECT sr.id, sr.synthesizer, sr.operator, sr.scale_nmol, sr.notes,
             sr.started_at, to_char(sr.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_date
      FROM synthesis_run sr WHERE sr.id = $1
    `, [runId])
    if (!runRes.rows.length) return res.status(404).json({ error: 'Run not found' })

    const linesRes = await client.query(`
      SELECT srl.plate_position, srl.status, srl.dmt, srl.result_notes, srl.calc_mw,
             srl.synth_sequence,
             srl.crude_od_260, srl.crude_a260_a280, srl.crude_conc_ng_ul, srl.crude_vol_ul,
             srl.purif_method,
             to_char(srl.purif_date, 'YYYY-MM-DD') AS purif_date,
             srl.purif_operator, srl.purif_notes,
             srl.purif_od_260, srl.purif_vol_ul, srl.purif_a260_a280, srl.purif_conc_ng_ul,
             srl.ms_done, srl.ms_pass, srl.ms_notes,
             srl.ce_done, srl.ce_pass, srl.ce_notes,
             s.name AS oligo_name, o.customer_ref AS order_ref,
             o.customer_name,
             c.company_name AS institute,
             ol.notes,
             v.annotated_sequence, v.oligo_type, v.length_nt
      FROM synthesis_run_line srl
      JOIN order_line ol ON ol.id = srl.order_line_id
      JOIN sequence s ON s.id = ol.sequence_id
      JOIN "order" o ON o.id = ol.order_id
      LEFT JOIN customer c ON c.id = o.customer_id
      JOIN v_annotated_sequence v ON v.sequence_id = s.id
      WHERE srl.run_id = $1
      ORDER BY srl.plate_position
    `, [runId])

    const modMapRes = await client.query(`
      SELECT smm.modification_id, smm.synth_slot, smm.material_lot_id,
             mc.canonical_name, mc.aliases,
             ml.lot_number AS lot_lot_number, ml.provider, ml.mw_addition
      FROM synthesis_run_mod_map smm
      JOIN modification_catalog mc ON mc.id = smm.modification_id
      LEFT JOIN material_lot ml ON ml.id = smm.material_lot_id
      WHERE smm.run_id = $1
      ORDER BY smm.synth_slot
    `, [runId])

    res.json({ run: runRes.rows[0], lines: linesRes.rows, mod_map: modMapRes.rows })
  })
})

// GET /api/runs/:id/reagents — reagent lots + CPG (carryover from prev run if none saved)
app.get('/api/runs/:id/reagents', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })

  await withDb(req, res, async (client) => {
    const ownLots = await client.query(`
      SELECT reagent_type, lot_number, solvent_lot, material_lot_id,
             to_char(date_replaced, 'YYYY-MM-DD') AS date_replaced, replaced_by
      FROM synthesis_run_reagent_lot WHERE run_id = $1
    `, [runId])
    const ownCpg = await client.query(`
      SELECT plate_position, lot_number, material_lot_id FROM synthesis_run_cpg WHERE run_id = $1
    `, [runId])

    if (ownLots.rows.length > 0 || ownCpg.rows.length > 0) {
      return res.json({ reagents: ownLots.rows, cpg: ownCpg.rows, carryover_from: null })
    }

    // No data yet — carry over from the most recent previous run
    const prevRun = await client.query(`
      SELECT id FROM synthesis_run WHERE id < $1 ORDER BY id DESC LIMIT 1
    `, [runId])
    if (!prevRun.rows.length) {
      return res.json({ reagents: [], cpg: [], carryover_from: null })
    }
    const prevId = prevRun.rows[0].id
    const prevLots = await client.query(`
      SELECT reagent_type, lot_number, solvent_lot, material_lot_id,
             to_char(date_replaced, 'YYYY-MM-DD') AS date_replaced, replaced_by
      FROM synthesis_run_reagent_lot WHERE run_id = $1
    `, [prevId])
    const prevCpg = await client.query(`
      SELECT plate_position, lot_number, material_lot_id FROM synthesis_run_cpg WHERE run_id = $1
    `, [prevId])
    res.json({ reagents: prevLots.rows, cpg: [], carryover_from: prevId })
  })
})

// PUT /api/runs/:id/results — save per-well OD, volume, status, notes
app.put('/api/runs/:id/results', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })
  const { results = [] } = req.body

  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      for (const r of results) {
        await client.query(`
          UPDATE synthesis_run_line SET
            status           = $1,  result_notes     = $2,
            crude_od_260     = $3,  crude_a260_a280  = $4,
            crude_conc_ng_ul = $5,  crude_vol_ul     = $6,
            purif_method     = $7,  purif_date       = $8,
            purif_operator   = $9,  purif_notes      = $10,
            purif_od_260     = $11, purif_a260_a280  = $12,
            purif_conc_ng_ul = $13, purif_vol_ul     = $14,
            ms_done          = $15, ms_pass          = $16, ms_notes = $17,
            ce_done          = $18, ce_pass          = $19, ce_notes = $20
          WHERE run_id = $21 AND plate_position = $22
        `, [
          r.status           || 'pending',
          r.result_notes     || null,
          r.crude_od_260     != null ? r.crude_od_260     : null,
          r.crude_a260_a280  != null ? r.crude_a260_a280  : null,
          r.crude_conc_ng_ul != null ? r.crude_conc_ng_ul : null,
          r.crude_vol_ul     != null ? r.crude_vol_ul     : null,
          r.purif_method     || null,
          r.purif_date       || null,
          r.purif_operator   || null,
          r.purif_notes      || null,
          r.purif_od_260     != null ? r.purif_od_260     : null,
          r.purif_a260_a280  != null ? r.purif_a260_a280  : null,
          r.purif_conc_ng_ul != null ? r.purif_conc_ng_ul : null,
          r.purif_vol_ul     != null ? r.purif_vol_ul     : null,
          r.ms_done || false,
          r.ms_pass != null ? r.ms_pass : null,
          r.ms_notes || null,
          r.ce_done || false,
          r.ce_pass != null ? r.ce_pass : null,
          r.ce_notes || null,
          runId, r.plate_position,
        ])
      }
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// PUT /api/runs/:id/reagents — upsert reagent lots + CPG
app.put('/api/runs/:id/reagents', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })
  const { reagents = [], cpg = [], mod_lots = [] } = req.body

  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      for (const r of reagents) {
        await client.query(`
          INSERT INTO synthesis_run_reagent_lot
            (run_id, reagent_type, lot_number, solvent_lot, date_replaced, replaced_by, material_lot_id)
          VALUES ($1,$2,$3,$4,$5::date,$6,$7)
          ON CONFLICT (run_id, reagent_type) DO UPDATE
            SET lot_number = EXCLUDED.lot_number, solvent_lot = EXCLUDED.solvent_lot,
                date_replaced = EXCLUDED.date_replaced, replaced_by = EXCLUDED.replaced_by,
                material_lot_id = EXCLUDED.material_lot_id
        `, [runId, r.reagent_type, r.lot_number || null, r.solvent_lot || null,
            r.date_replaced || null, r.replaced_by || null, r.material_lot_id || null])
      }
      for (const c of cpg) {
        if (!c.plate_position) continue
        if (!c.lot_number && !c.material_lot_id) continue
        await client.query(`
          INSERT INTO synthesis_run_cpg (run_id, plate_position, lot_number, material_lot_id)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (run_id, plate_position) DO UPDATE
            SET lot_number = EXCLUDED.lot_number, material_lot_id = EXCLUDED.material_lot_id
        `, [runId, c.plate_position, c.lot_number || null, c.material_lot_id || null])
      }
      // Link material lots to modification slots (enables lot-specific mw_addition in calc)
      for (const m of mod_lots) {
        if (!m.material_lot_id || !m.canonical_name) continue
        await client.query(`
          UPDATE synthesis_run_mod_map smm
          SET material_lot_id = $1
          FROM modification_catalog mc
          WHERE mc.id = smm.modification_id
            AND mc.canonical_name = $2
            AND smm.run_id = $3
        `, [m.material_lot_id, m.canonical_name, runId])
      }
      // Recalculate MW for all lines in this run
      await recalcRunMws(client, runId)
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// GET /api/runs/:id/orders — unique orders in a run with full customer address + partial flag
app.get('/api/runs/:id/orders', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })
  await withDb(req, res, async (client) => {
    const result = await client.query(`
      SELECT
        o.id           AS order_id,
        o.customer_ref AS order_ref,
        o.customer_name,
        o.customer_id,
        c.company_name,
        c.contact_name,
        c.building_name,
        c.lab,
        c.street,
        c.city,
        c.zip,
        c.phone,
        c.email,
        COUNT(DISTINCT srl.id)::int                                   AS lines_in_run,
        (SELECT COUNT(*)::int FROM order_line ol2 WHERE ol2.order_id = o.id) AS total_lines
      FROM synthesis_run_line srl
      JOIN order_line ol ON ol.id = srl.order_line_id
      JOIN "order" o ON o.id = ol.order_id
      LEFT JOIN customer c ON c.id = o.customer_id
      WHERE srl.run_id = $1
      GROUP BY o.id, o.customer_ref, o.customer_name, o.customer_id,
               c.company_name, c.contact_name, c.building_name, c.lab,
               c.street, c.city, c.zip, c.phone, c.email
      ORDER BY o.customer_ref
    `, [runId])
    const rows = result.rows.map(r => ({
      ...r,
      is_partial: r.lines_in_run < r.total_lines,
    }))
    res.json(rows)
  })
})

// ── Shipping label helpers ────────────────────────────────────────────────────

function noBorders() {
  return {
    top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  }
}

function tr(text, opts = {}) {
  return new TextRun({ text, font: 'Aptos', ...opts })
}

function stickerTable(order) {
  const name      = order.contact_name || order.customer_name || ''
  const institute = order.company_name || ''
  const building  = order.building_name || ''
  const room      = order.lab || ''
  const phone     = order.phone || ''
  const orderNote = `Order #${order.order_ref || order.order_id}${order.is_partial ? ' (partial)' : ''}`

  const logoRow = logoBuffer
    ? [new TableRow({
        children: [new TableCell({
          borders: noBorders(),
          children: [new Paragraph({
            children: [new ImageRun({
              data: logoBuffer,
              transformation: { width: 300, height: 101 },
            })],
          })],
        })],
      })]
    : []

  // True bordered box via a 1×1 nested table
  const storeBox = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      bottom:           { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      left:             { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      right:            { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      insideHorizontal: { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' },
      insideVertical:   { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' },
    },
    rows: [new TableRow({
      children: [new TableCell({
        borders: noBorders(),
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [tr('Store at -20°C', { bold: true, italics: true, size: 26 })],
        })],
      })],
    })],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom:           { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left:             { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right:            { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      // TO block
      new TableRow({
        children: [new TableCell({
          borders: noBorders(),
          children: [
            new Paragraph({
              spacing: { after: 300 },
              children: [
                tr('To:', { bold: true, size: 28 }),
                tr(`    ${name}`, { bold: true, size: 28 }),
              ],
            }),
            ...(institute ? [new Paragraph({ children: [tr(institute, { bold: true, size: 26 })] })] : []),
            ...(building  ? [new Paragraph({ children: [tr(building,  { bold: true, size: 26 })] })] : []),
            ...(room      ? [new Paragraph({ children: [tr(room,      { bold: true, size: 26 })] })] : []),
            ...(phone     ? [new Paragraph({ spacing: { before: 200 }, children: [tr(phone, { bold: true, size: 26 })] })] : []),
          ],
        })],
      }),

      // FROM
      new TableRow({
        children: [new TableCell({
          borders: noBorders(),
          children: [
            new Paragraph({
              spacing: { before: 300, after: 100 },
              children: [tr(`From: ${process.env.COMPANY_NAME || 'Our Company'}`, { bold: true, size: 28 })],
            }),
            new Paragraph({
              spacing: { after: 100 },
              children: [tr(orderNote, { size: 20, color: '555555' })],
            }),
          ],
        })],
      }),

      // Logo
      ...logoRow,

      // Handle with care
      new TableRow({
        children: [new TableCell({
          borders: noBorders(),
          children: [new Paragraph({
            spacing: { before: 400, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [tr('Client Delivery - Handle with Care', { italics: true, bold: true, size: 26 })],
          })],
        })],
      }),

      // Store at -20°C — nested table for a real box
      new TableRow({
        children: [new TableCell({
          borders: noBorders(),
          children: [storeBox],
        })],
      }),
    ],
  })
}

function buildShippingDoc(orders) {
  // A4 page (16838 twips) minus 1-inch top+bottom margins (2880 twips) = 13958 twips.
  // Reserve ~240 twips (one line) for the mandatory trailing paragraph Word appends.
  // Two sticker rows per page → each row gets half of the remainder.
  const ROW_HEIGHT = Math.floor((16838 - 2880 - 240) / 2) // 6859 twips

  // Outer 2-column table: each row holds a pair of stickers side by side.
  // Even pairs (0, 2, …) sit at the top of their half-page → TOP aligned.
  // Odd pairs  (1, 3, …) sit at the bottom               → BOTTOM aligned.
  const outerRows = []
  for (let i = 0; i < orders.length; i += 2) {
    const pairIndex = Math.floor(i / 2)
    const vAlign    = pairIndex % 2 === 0 ? VerticalAlign.TOP : VerticalAlign.BOTTOM
    const left      = orders[i]
    const right     = orders[i + 1] || null

    outerRows.push(new TableRow({
      height: { value: ROW_HEIGHT, rule: HeightRule.EXACT },
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: noBorders(),
          verticalAlign: vAlign,
          margins: { right: 500 },
          children: [stickerTable(left)],
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: noBorders(),
          verticalAlign: vAlign,
          children: right ? [stickerTable(right)] : [new Paragraph({ children: [] })],
        }),
      ],
    }))
  }

  const outerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom:           { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left:             { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right:            { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: outerRows,
  })

  return new Document({
    sections: [{
      properties: {
        page: {
          size:   { width: 11906, height: 16838 },
          margin: { top: 1440, right: 991, bottom: 1440, left: 1560 },
        },
      },
      children: [
        outerTable,
        new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ size: 2 })] }),
      ],
    }],
  })
}

// POST /api/runs/:id/shipping-labels — generate .docx for selected orders
app.post('/api/runs/:id/shipping-labels', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })
  const { order_ids } = req.body
  if (!Array.isArray(order_ids) || !order_ids.length)
    return res.status(400).json({ error: 'order_ids required' })

  await withDb(req, res, async (client) => {
    const placeholders = order_ids.map((_, i) => `$${i + 2}`).join(', ')
    const result = await client.query(`
      SELECT
        o.id           AS order_id,
        o.customer_ref AS order_ref,
        o.customer_name,
        o.customer_id,
        c.company_name,
        c.contact_name,
        c.building_name,
        c.lab,
        c.street,
        c.city,
        c.zip,
        c.phone,
        c.email,
        (SELECT COUNT(*)::int FROM synthesis_run_line srl2
         JOIN order_line ol2 ON ol2.id = srl2.order_line_id
         WHERE srl2.run_id = $1 AND ol2.order_id = o.id) AS lines_in_run,
        (SELECT COUNT(*)::int FROM order_line ol3 WHERE ol3.order_id = o.id) AS total_lines
      FROM "order" o
      LEFT JOIN customer c ON c.id = o.customer_id
      WHERE o.id IN (${placeholders})
      ORDER BY o.customer_ref
    `, [runId, ...order_ids])

    const orders = result.rows.map(r => ({
      ...r,
      is_partial: r.lines_in_run < r.total_lines,
    }))

    const doc = buildShippingDoc(orders)
    const buffer = await Packer.toBuffer(doc)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="run${runId}_shipping_labels.docx"`)
    res.send(buffer)
  })
})

// POST /api/runs
app.post('/api/runs', async (req, res) => {
  const { synthesizer, operator, notes, scale_nmol, lines, mod_map } = req.body
  if (!lines?.length) return res.status(400).json({ error: 'lines required' })
  console.log(`POST /api/runs — ${lines.length} lines, ${(mod_map||[]).length} mod_map entries`, mod_map)

  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      const runRes = await client.query(
        `INSERT INTO synthesis_run (synthesizer, operator, notes, scale_nmol)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [synthesizer || null, operator || null, notes || null, scale_nmol || null]
      )
      const runId = runRes.rows[0].id

      for (const line of lines) {
        await client.query(
          `INSERT INTO synthesis_run_line (run_id, order_line_id, plate_position, status, dmt)
           VALUES ($1, $2, $3, 'pending', $4)`,
          [runId, line.order_line_id, line.plate_position, line.dmt || 'DMT OFF']
        )
      }

      for (const entry of (mod_map || [])) {
        await client.query(
          `INSERT INTO synthesis_run_mod_map (run_id, modification_id, synth_slot)
           VALUES ($1, $2, $3)`,
          [runId, entry.modification_id, entry.synth_slot]
        )
      }

      // ── compute & store substituted sequences ────────────────────────────────
      const modSubsRes = await client.query(`
        SELECT mc.canonical_name, mc.aliases, smm.synth_slot
        FROM synthesis_run_mod_map smm
        JOIN modification_catalog mc ON mc.id = smm.modification_id
        WHERE smm.run_id = $1
      `, [runId])

      if (modSubsRes.rows.length > 0) {
        const lineSeqRes = await client.query(`
          SELECT srl.id, v.annotated_sequence
          FROM synthesis_run_line srl
          JOIN order_line ol ON ol.id = srl.order_line_id
          JOIN v_annotated_sequence v ON v.sequence_id = ol.sequence_id
          WHERE srl.run_id = $1
        `, [runId])

        for (const line of lineSeqRes.rows) {
          const synthSeq = applyModSubstitutions(line.annotated_sequence, modSubsRes.rows)
          await client.query(
            'UPDATE synthesis_run_line SET synth_sequence = $1 WHERE id = $2',
            [synthSeq, line.id]
          )
        }
      }

      await client.query('COMMIT')
      res.json({ run_id: runId, line_count: lines.length })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// DELETE /api/runs/:id
app.delete('/api/runs/:id', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })
  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query('DELETE FROM synthesis_run_mod_map WHERE run_id = $1', [runId])
      await client.query('DELETE FROM synthesis_run_line WHERE run_id = $1', [runId])
      await client.query('DELETE FROM synthesis_run WHERE id = $1', [runId])
      // Revert orders to 'received' if they no longer have lines in any started run
      await client.query(`
        UPDATE "order" SET status = 'received'
        WHERE status = 'in_progress'
        AND id NOT IN (
          SELECT DISTINCT ol.order_id
          FROM synthesis_run_line srl
          JOIN order_line ol ON ol.id = srl.order_line_id
          JOIN synthesis_run sr ON sr.id = srl.run_id
          WHERE sr.started_at IS NOT NULL
        )
      `)
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// POST /api/runs/:id/start — mark run started, set orders to in_progress
app.post('/api/runs/:id/start', async (req, res) => {
  const runId = parseInt(req.params.id)
  if (!runId) return res.status(400).json({ error: 'invalid run id' })

  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      await client.query(
        `UPDATE synthesis_run SET started_at = NOW() WHERE id = $1`,
        [runId]
      )
      await client.query(`
        UPDATE "order" SET status = 'in_progress'
        WHERE id IN (
          SELECT DISTINCT ol.order_id
          FROM synthesis_run_line srl
          JOIN order_line ol ON ol.id = srl.order_line_id
          WHERE srl.run_id = $1
        )
      `, [runId])
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
})

// ── Surcharges ────────────────────────────────────────────────────────────────

app.get('/api/surcharges', async (req, res) => {
  await withDb(req, res, async (client) => {
    const r = await client.query('SELECT * FROM surcharge_config ORDER BY id')
    res.json(r.rows)
  })
})

app.put('/api/surcharges', async (req, res) => {
  const { surcharges } = req.body
  if (!Array.isArray(surcharges)) return res.status(400).json({ error: 'surcharges array required' })
  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      for (const s of surcharges) {
        await client.query(`
          INSERT INTO surcharge_config (purification, surcharge)
          VALUES ($1, $2)
          ON CONFLICT (purification) DO UPDATE SET surcharge = EXCLUDED.surcharge, updated_at = NOW()
        `, [s.purification, parseFloat(s.surcharge) || 0])
      }
      await client.query('COMMIT')
      const r = await client.query('SELECT * FROM surcharge_config ORDER BY id')
      res.json(r.rows)
    } catch (err) { await client.query('ROLLBACK'); throw err }
  })
})

// ── Quotes ────────────────────────────────────────────────────────────────────

app.get('/api/quotes', async (req, res) => {
  await withDb(req, res, async (client) => {
    const r = await client.query(`
      SELECT q.id, q.display_id, q.order_id, q.status, q.discount_pct, q.discount_abs, q.notes,
             to_char(q.created_at, 'YYYY-MM-DD') AS created_date,
             o.customer_ref, o.customer_name, o.customer_email,
             COUNT(ql.id) FILTER (WHERE ql.included)::int AS line_count,
             COALESCE(SUM(
               CASE WHEN ql.included THEN
                 length(ql.sequence_text) * 0.7 + COALESCE(sc.surcharge, 0)
               ELSE 0 END
             ), 0) AS subtotal
      FROM quote q
      LEFT JOIN "order" o ON o.id = q.order_id
      LEFT JOIN quote_line ql ON ql.quote_id = q.id
      LEFT JOIN surcharge_config sc ON sc.purification = ql.purification
      GROUP BY q.id, o.customer_ref, o.customer_name, o.customer_email
      ORDER BY q.created_at DESC
    `)
    res.json(r.rows)
  })
})

app.get('/api/quotes/:id', async (req, res) => {
  await withDb(req, res, async (client) => {
    const qr = await client.query(`
      SELECT q.*, to_char(q.created_at, 'YYYY-MM-DD') AS created_date,
             o.customer_ref, o.customer_name, o.customer_email
      FROM quote q LEFT JOIN "order" o ON o.id = q.order_id
      WHERE q.id = $1
    `, [req.params.id])
    if (!qr.rows.length) return res.status(404).json({ error: 'Quote not found' })
    const lr = await client.query(
      'SELECT * FROM quote_line WHERE quote_id = $1 ORDER BY sort_order, id',
      [req.params.id]
    )
    res.json({ ...qr.rows[0], lines: lr.rows })
  })
})

// Helper: save lines for a quote (replaces all existing lines)
async function saveQuoteLines(client, quoteId, orderId, lines) {
  await client.query('DELETE FROM quote_line WHERE quote_id = $1', [quoteId])
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    let orderLineId = l.order_line_id || null
    let sequenceId  = l.sequence_id  || null

    if (l._new && orderId) {
      const seqRes = await client.query('SELECT insert_idt_sequence($1) AS id', [l.sequence_text])
      sequenceId = seqRes.rows[0].id
      const pr = (await client.query('SELECT * FROM parse_idt_sequence($1)', [l.sequence_text])).rows[0]
      const tokens = pr ? { bases: pr.clean_bases, oligo_type: pr.oligo_type, modifications: [] } : null
      const mw = tokens ? calcMolWeight(tokens.bases, tokens.oligo_type) : null
      await client.query(
        'UPDATE sequence SET name=$1, order_id=$2, raw_idt=$3, tokens=$4, mol_weight=$5 WHERE id=$6',
        [l.oligo_name || null, orderId, l.sequence_text, tokens ? JSON.stringify(tokens) : null, mw, sequenceId]
      )
      const lineNum = (await client.query(
        'SELECT COALESCE(MAX(line_number),0)+1 AS n FROM order_line WHERE order_id=$1', [orderId]
      )).rows[0].n
      orderLineId = (await client.query(
        `INSERT INTO order_line (order_id, sequence_id, customer_label, quantity_nmol, priority, line_number, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [orderId, sequenceId, l.oligo_name || null, l.scale_nmol || null, lineNum, lineNum,
         `Purification: ${l.purification || 'Standard Desalt'}`]
      )).rows[0].id
    }

    await client.query(`
      INSERT INTO quote_line (quote_id, order_line_id, sequence_id, oligo_name, sequence_text, purification, scale_nmol, included, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [quoteId, orderLineId, sequenceId, l.oligo_name || null, l.sequence_text,
        l.purification || 'Standard Desalt', l.scale_nmol || null, l.included !== false, i])
  }
}

app.post('/api/quotes', async (req, res) => {
  const { order_id, discount_pct, discount_abs, status, notes, lines = [] } = req.body
  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      const { displayId, internalSeq } = await generateId('quote', client)
      const qr = await client.query(
        `INSERT INTO quote (display_id, internal_seq, order_id, discount_pct, discount_abs, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [displayId, internalSeq, order_id || null, discount_pct || 0, discount_abs || 0, status || 'draft', notes || null]
      )
      const quoteId = qr.rows[0].id
      await saveQuoteLines(client, quoteId, order_id || null, lines)
      await client.query('COMMIT')
      res.json({ id: quoteId, display_id: displayId, internal_seq: internalSeq })
    } catch (err) { await client.query('ROLLBACK'); throw err }
  })
})

app.put('/api/quotes/:id', async (req, res) => {
  const { discount_pct, discount_abs, status, notes, lines } = req.body
  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      const qr = await client.query('SELECT order_id FROM quote WHERE id=$1', [req.params.id])
      if (!qr.rows.length) return res.status(404).json({ error: 'Quote not found' })
      const orderId = qr.rows[0].order_id
      await client.query(`
        UPDATE quote SET
          discount_pct = $1, discount_abs = $2, status = $3, notes = $4, updated_at = NOW()
        WHERE id = $5
      `, [discount_pct ?? 0, discount_abs ?? 0, status || 'draft', notes || null, req.params.id])
      if (Array.isArray(lines)) await saveQuoteLines(client, parseInt(req.params.id), orderId, lines)
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) { await client.query('ROLLBACK'); throw err }
  })
})

app.delete('/api/quotes/:id', async (req, res) => {
  await withDb(req, res, async (client) => {
    await client.query('DELETE FROM quote WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  })
})

// POST /api/quotes/:id/convert — convert a quote to a sales order (SO- prefix, same suffix)
app.post('/api/quotes/:id/convert', async (req, res) => {
  const quoteId = parseInt(req.params.id)
  if (!quoteId) return res.status(400).json({ error: 'invalid quote id' })
  await withDb(req, res, async (client) => {
    await client.query('BEGIN')
    try {
      const so = await convertQuoteToOrder(quoteId, client)
      await client.query('COMMIT')
      res.json(so)
    } catch (err) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: err.message })
    }
  })
})

// GET /api/quotes/:id/docx — download quote as Word document
app.get('/api/quotes/:id/docx', async (req, res) => {
  const quoteId = parseInt(req.params.id)
  if (!quoteId) return res.status(400).json({ error: 'invalid quote id' })

  await withDb(req, res, async (client) => {
    const qr = await client.query(`
      SELECT q.*, to_char(q.created_at, 'DD/MM/YYYY') AS date_fmt,
             o.customer_ref, o.customer_name, o.customer_email,
             c.company_name AS institute, c.contact_name
      FROM quote q
      LEFT JOIN "order" o ON o.id = q.order_id
      LEFT JOIN customer c ON c.id = o.customer_id
      WHERE q.id = $1
    `, [quoteId])
    if (!qr.rows.length) return res.status(404).json({ error: 'Quote not found' })
    const q = qr.rows[0]

    const lr = await client.query(
      `SELECT * FROM quote_line WHERE quote_id = $1 AND included = true ORDER BY sort_order, id`,
      [quoteId]
    )
    const lines = lr.rows

    const scr = await client.query('SELECT purification, surcharge FROM surcharge_config')
    const surchargeMap = {}
    for (const s of scr.rows) surchargeMap[s.purification] = parseFloat(s.surcharge) || 0

    const PRICE_PER_NT = 0.7
    const VAT_RATE     = 0.18
    const TEAL         = '007a6a'
    const LIGHT_GRAY   = 'f5f7fb'
    const MID_GRAY     = '5a6278'
    const BORDER_COL   = 'e0e4ef'

    function lp(l) {
      return ((l.sequence_text || '').replace(/[^A-Za-z]/g, '').length * PRICE_PER_NT)
        + (surchargeMap[l.purification] || 0)
    }
    const subtotal = lines.reduce((s, l) => s + lp(l), 0)
    const discPct  = parseFloat(q.discount_pct) || 0
    const discAbs  = parseFloat(q.discount_abs) || 0
    const disc     = subtotal * (discPct / 100) + discAbs
    const net      = Math.max(0, subtotal - disc)
    const vat      = net * VAT_RATE
    const total    = net + vat

    function fmtN(n) {
      return '₪ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    // ── shared border helpers ──
    const nb   = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    const nbs  = { top: nb, bottom: nb, left: nb, right: nb, insideHorizontal: nb, insideVertical: nb }
    const cb   = { style: BorderStyle.SINGLE, size: 4, color: BORDER_COL }
    const cbs  = { top: cb, bottom: cb, left: cb, right: cb }
    const cm   = { top: 80, bottom: 80, left: 120, right: 120 }

    function tc(text, { bold=false, color='1a1d2e', bg=null, align=AlignmentType.LEFT,
                         mono=false, sz=20, borders=cbs, width=null } = {}) {
      return new TableCell({
        borders,
        width:   width ? { size: width, type: WidthType.DXA } : undefined,
        shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
        margins: cm,
        children: [new Paragraph({
          alignment: align,
          children: [new TextRun({ text: String(text ?? ''), bold, color, font: mono ? 'Courier New' : 'Aptos', size: sz })]
        })]
      })
    }

    // ── content width: A4 minus 1440 margins each side = 9026 DXA ──
    const CW = 9026

    // ── 1. Header: logo left, company info right ──
    const logoCell = logoBuffer
      ? [new TableCell({
          borders: nbs, width: { size: 2000, type: WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: 300 },
          children: [new Paragraph({ children: [new ImageRun({
            data: logoBuffer, type: 'png',
            transformation: { width: 130, height: 44 },
            altText: { title: 'Logo', description: process.env.COMPANY_NAME || 'Logo', name: 'logo' }
          })] })]
        })]
      : []

    const infoWidth = logoBuffer ? CW - 2000 : CW
    const infoCell = new TableCell({
      borders: nbs, width: { size: infoWidth, type: WidthType.DXA },
      children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: process.env.COMPANY_NAME || '', bold: true, font: 'Aptos', size: 24, color: TEAL })] }),
        ...(process.env.COMPANY_ADDRESS ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: process.env.COMPANY_ADDRESS, font: 'Aptos', size: 18, color: MID_GRAY })] })] : []),
        ...(process.env.COMPANY_PHONE_WEB ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: process.env.COMPANY_PHONE_WEB, font: 'Aptos', size: 18, color: MID_GRAY })] })] : []),
      ]
    })

    const headerTable = new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: logoBuffer ? [2000, infoWidth] : [CW],
      borders: nbs,
      rows: [new TableRow({ children: [...logoCell, infoCell] })]
    })

    // ── 2. Divider ──
    const divider = new Paragraph({
      spacing: { before: 200, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 4 } },
      children: []
    })

    // ── 3. Title ──
    const titlePara = new Paragraph({
      spacing: { before: 280, after: 80 },
      children: [new TextRun({ text: 'Sales Quotation', bold: true, font: 'Aptos', size: 40, color: TEAL })]
    })

    // ── 4. Meta table ──
    function mRow(label, value) {
      return new TableRow({ children: [
        new TableCell({ borders: nbs, width: { size: 2000, type: WidthType.DXA }, margins: { top: 55, bottom: 55, left: 0, right: 0 },
          children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Aptos', size: 20, bold: true, color: MID_GRAY })] })] }),
        new TableCell({ borders: nbs, width: { size: CW - 2000, type: WidthType.DXA }, margins: { top: 55, bottom: 55, left: 120, right: 0 },
          children: [new Paragraph({ children: [new TextRun({ text: String(value ?? '—'), font: 'Aptos', size: 20, color: '1a1d2e' })] })] }),
      ]})
    }

    const customerLabel = [q.customer_name, q.institute || q.company_name].filter(Boolean).join('  |  ') || '—'
    const discLabel = disc > 0
      ? (discPct > 0 && discAbs > 0 ? `${discPct}% + ₪${discAbs.toFixed(2)}`
         : discPct > 0 ? `${discPct}%` : `₪${discAbs.toFixed(2)}`)
      : null

    const metaRows = [
      mRow('Quotation #:', `${q.display_id || `Q-${q.id}`}${q.customer_ref ? `  (Order #${q.customer_ref})` : ''}`),
      mRow('Date:', q.date_fmt),
      mRow('Submitted To:', customerLabel),
      q.customer_email ? mRow('Email:', q.customer_email) : null,
      process.env.QUOTE_SUBMITTED_BY ? mRow('Submitted By:', process.env.QUOTE_SUBMITTED_BY) : null,
      discLabel ? mRow('Discount:', discLabel) : null,
    ].filter(Boolean)

    const metaTable = new Table({
      width: { size: CW, type: WidthType.DXA }, columnWidths: [2000, CW - 2000],
      borders: nbs, rows: metaRows
    })

    // ── 5. Oligo table ──
    // Cols: # | Name | Sequence | Len | Scale | Purification | Price
    const COLS = [380, 2000, 2200, 520, 620, 1706, 1600]  // sum = 9026
    const hdr = (t, align = AlignmentType.LEFT) => new TableCell({
      borders: cbs, shading: { fill: TEAL, type: ShadingType.CLEAR }, margins: cm,
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text: t, bold: true, font: 'Aptos', size: 18, color: 'FFFFFF' })] })]
    })

    const oligoTable = new Table({
      width: { size: CW, type: WidthType.DXA }, columnWidths: COLS,
      rows: [
        new TableRow({ tableHeader: true, children: [
          hdr('#', AlignmentType.CENTER), hdr('Name'), hdr('Sequence'),
          hdr('Len', AlignmentType.RIGHT), hdr('Scale', AlignmentType.RIGHT),
          hdr('Purification'), hdr('Price', AlignmentType.RIGHT),
        ]}),
        ...lines.map((l, i) => {
          const bg   = i % 2 === 1 ? LIGHT_GRAY : 'FFFFFF'
          const len  = (l.sequence_text || '').replace(/[^A-Za-z]/g, '').length
          const seq  = l.sequence_text && l.sequence_text.length > 22
            ? l.sequence_text.slice(0, 21) + '…' : (l.sequence_text || '')
          return new TableRow({ children: [
            tc(i + 1, { align: AlignmentType.CENTER, color: MID_GRAY, sz: 18, bg }),
            tc(l.oligo_name || '', { sz: 18, bg }),
            tc(seq, { mono: true, sz: 16, color: '007a6a', bg }),
            tc(len,  { align: AlignmentType.RIGHT, sz: 18, bg }),
            tc(l.scale_nmol ? `${l.scale_nmol} nmol` : '—', { align: AlignmentType.RIGHT, sz: 18, bg }),
            tc(l.purification, { sz: 18, bg }),
            tc(fmtN(lp(l)), { align: AlignmentType.RIGHT, mono: true, sz: 18, bg }),
          ]})
        }),
      ]
    })

    // ── 6. Summary ──
    function sRow(label, value, opts = {}) {
      const topB = opts.topBorder ? { style: BorderStyle.SINGLE, size: 4, color: BORDER_COL } : nb
      const topBs = { top: topB, bottom: nb, left: nb, right: nb }
      return new TableRow({ children: [
        new TableCell({ borders: nbs, width: { size: CW - 2600, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
        new TableCell({ borders: topBs, width: { size: 1300, type: WidthType.DXA }, margins: { top: 55, bottom: 55, left: 0, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Aptos', bold: opts.bold, size: opts.sz || 20, color: opts.color || MID_GRAY })] })] }),
        new TableCell({ borders: topBs, width: { size: 1300, type: WidthType.DXA }, margins: { top: 55, bottom: 55, left: 0, right: 0 },
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: value, font: 'Courier New', bold: opts.bold, size: opts.sz || 20, color: opts.color || '1a1d2e' })] })] }),
      ]})
    }

    const sumRows = [sRow('Subtotal', fmtN(subtotal))]
    if (disc > 0) sumRows.push(sRow('Discount', `− ${fmtN(disc)}`, { color: 'd93a51' }))
    sumRows.push(sRow('Net', fmtN(net)))
    sumRows.push(sRow(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, fmtN(vat)))
    sumRows.push(sRow('Total', fmtN(total), { bold: true, sz: 24, color: TEAL, topBorder: true }))

    const summaryTable = new Table({
      width: { size: CW, type: WidthType.DXA }, columnWidths: [CW - 2600, 1300, 1300],
      borders: nbs, rows: sumRows
    })

    // ── 7. Notes + footer ──
    const notesChildren = q.notes
      ? [new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: `Notes: ${q.notes}`, font: 'Aptos', size: 20, color: MID_GRAY, italics: true })] })]
      : []

    const footer = [
      new Paragraph({
        spacing: { before: 320, after: 80 },
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 6 } },
        children: [new TextRun({ text: 'Prices do not include VAT.  |  המחיר לא כולל מע"מ.', font: 'Aptos', size: 18, color: MID_GRAY })]
      }),
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [new TextRun({ text: 'Please confirm to proceed. Thank you!  |  נשמח על אישורך להמשך טיפול. תודה, אוליגו ביוטק', font: 'Aptos', size: 18, color: MID_GRAY })]
      }),
    ]

    // ── Assemble ──
    const doc = new Document({
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: [
          headerTable, divider, titlePara,
          metaTable,
          new Paragraph({ spacing: { before: 280, after: 120 }, children: [] }),
          oligoTable,
          new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),
          summaryTable,
          ...notesChildren,
          ...footer,
        ]
      }]
    })

    const buf  = await Packer.toBuffer(doc)
    const name = `Quote-${q.display_id || `Q-${q.id}`}${q.customer_ref ? `-Order${q.customer_ref}` : ''}.docx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.send(buf)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Oligo backend running on http://localhost:${PORT}`))
