import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LoginPage from './components/auth/LoginPage.jsx'
import { loadSession } from './lib/auth.js'

// The console only mounts behind a server-side investigator session (src/webapp/auth.py).
// entry file: nothing imports it, so fast-refresh boundaries do not apply
// eslint-disable-next-line react-refresh/only-export-components
function Gate() {
  const [session, setSession] = useState(undefined)   // undefined = still asking the server
  useEffect(() => { loadSession().then(setSession) }, [])
  if (session === undefined) return null
  return session ? <App /> : <LoginPage onAuthed={setSession} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
)
