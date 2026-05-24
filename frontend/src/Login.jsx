import { useState } from 'react'
import { makeApi } from './api'
import './Login.css'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('postgres')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const api = makeApi({ username, password })
      await api.get('/modifications')
      onLogin({ username, password })
    } catch (err) {
      sessionStorage.removeItem('oligo_creds')
      setError('Authentication failed. Check your PostgreSQL credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <span className="logo-dna">5'</span>
            <span className="logo-line" />
            <span className="logo-dna">3'</span>
          </div>
          <h1>OligoSynth</h1>
          <p>Oligonucleotide Production System</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Database User</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div className="notice error">{error}</div>}

          <button className="btn-primary login-btn" type="submit" disabled={loading}>
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </form>

        <div className="login-footer">
          PostgreSQL · localhost:5432 · oligosynth
        </div>
      </div>
    </div>
  )
}
