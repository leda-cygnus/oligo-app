import { useState } from 'react'
import Login from './Login'
import Dashboard from './Dashboard'
import './App.css'

const CRED_KEY = 'oligo_creds'

export default function App() {
  const [credentials, setCredentials] = useState(() => {
    try {
      const s = sessionStorage.getItem(CRED_KEY)
      return s ? JSON.parse(s) : null
    } catch { return null }
  })

  function handleLogin(creds) {
    sessionStorage.setItem(CRED_KEY, JSON.stringify(creds))
    setCredentials(creds)
  }

  function handleLogout() {
    sessionStorage.removeItem(CRED_KEY)
    setCredentials(null)
  }

  return credentials
    ? <Dashboard credentials={credentials} onLogout={handleLogout} />
    : <Login onLogin={handleLogin} />
}
