import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../services/firebase'
import { executarCatchUpDepreciacao } from '../services/depreciacao'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setUsuario(user)
      if (user) {
        // Roda catch-up de depreciação silenciosamente ao fazer login
        executarCatchUpDepreciacao(user.uid)
      }
    })
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