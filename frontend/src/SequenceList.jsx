import { useState, useEffect, useMemo } from 'react'

const COLS = [
  { key: 'oligo_name',         label: 'Name' },
  { key: 'order_number',       label: 'Order #' },
  { key: 'order_date',         label: 'Date / Time' },
  { key: 'annotated_sequence', label: 'Sequence' },
  { key: 'oligo_type',         label: 'Type' },
  { key: 'length_nt',          label: 'Length' },
]

export default function SequenceList({ api, onNavigateToOrder }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [filter, setFilter]   = useState('')
  const [sort, setSort]       = useState({ col: 'order_date', dir: 'desc' })

  useEffect(() => {
    api.get('/sequences')
      .then(setRows)
      .catch(() => setError('Failed to load sequences'))
      .finally(() => setLoading(false))
  }, [])

  function toggleSort(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  const displayed = useMemo(() => {
    const q = filter.toLowerCase()
    const filtered = q
      ? rows.filter(r =>
          (r.oligo_name         || '').toLowerCase().includes(q) ||
          (r.annotated_sequence || '').toLowerCase().includes(q) ||
          (r.order_number       || '').toLowerCase().includes(q) ||
          (r.oligo_type         || '').toLowerCase().includes(q)
        )
      : rows
    return [...filtered].sort((a, b) => {
      const av = a[sort.col] ?? ''
      const bv = b[sort.col] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, filter, sort])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
  if (error)   return <div className="notice error">{error}</div>

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Sequences</h2>
          <p>{displayed.length}{displayed.length !== rows.length ? ` of ${rows.length}` : ''} sequence{rows.length !== 1 ? 's' : ''}</p>
        </div>
        <input
          className="filter-input"
          placeholder="Filter by name, sequence, order…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="notice warn">No sequences yet. Use "Enter Sequence" to add one.</div>
      ) : (
        <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
        <table>
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key}
                    onClick={() => toggleSort(c.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                  {c.label}{' '}
                  {sort.col === c.key
                    ? (sort.dir === 'asc' ? '↑' : '↓')
                    : <span style={{ opacity: 0.3 }}>↕</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map(r => (
              <tr key={r.sequence_id}>
                <td className="primary">{r.oligo_name ?? '—'}</td>
                <td className="mono"
                    onClick={() => r.order_id && onNavigateToOrder(r.order_id, r.order_number)}
                    style={r.order_id ? { cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' } : {}}>
                  {r.order_number ?? '—'}
                </td>
                <td className="mono">{r.order_date ?? '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.04em', textAlign: 'left' }}>
                  {r.annotated_sequence}
                </td>
                <td>
                  <span className={`tag ${r.oligo_type === 'DNA' ? '' : r.oligo_type === 'RNA' ? 'rna' : 'mixed'}`}>
                    {r.oligo_type}
                  </span>
                </td>
                <td className="mono">{r.length_nt} nt</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
