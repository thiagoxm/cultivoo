import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../services/firebase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUsuario(user))
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ usuario }}>
      {usuario !== undefined && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}