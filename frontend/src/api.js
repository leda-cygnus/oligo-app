import axios from 'axios'

const BASE = 'http://localhost:3001/api'

export function makeApi(credentials) {
  const headers = credentials
    ? { Authorization: 'Basic ' + btoa(`${credentials.username}:${credentials.password}`) }
    : {}

  const get     = (path) => axios.get(`${BASE}${path}`, { headers }).then(r => r.data)
  const post    = (path, body) => axios.post(`${BASE}${path}`, body, { headers }).then(r => r.data)
  const put     = (path, body) => axios.put(`${BASE}${path}`, body, { headers }).then(r => r.data)
  const patch   = (path, body) => axios.patch(`${BASE}${path}`, body, { headers }).then(r => r.data)
  const del     = (path) => axios.delete(`${BASE}${path}`, { headers }).then(r => r.data)
  const upload  = (path, file) => {
    const form = new FormData()
    form.append('file', file)
    return axios.post(`${BASE}${path}`, form, { headers }).then(r => r.data)
  }
  // Returns raw fetch Response (for binary downloads) — never throws, caller checks resp.ok
  const postRaw = (path, body) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const getRaw = (path) =>
    fetch(`${BASE}${path}`, { method: 'GET', headers })

  return { get, post, put, patch, del, upload, postRaw, getRaw }
}
