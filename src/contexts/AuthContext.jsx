import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from '../services/firebase'
import { executarCatchUpDepreciacao } from '../services/depreciacao'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined)
  const [propriedadesCompartilhadas, setPropriedadesCompartilhadas] = useState([])

  async function carregarCompartilhadas(email) {
    try {
      const snap = await getDocs(
        query(
          collection(db, 'convites'),
          where('emailConvidado', '==', email),
          where('status', '==', 'aceito')
        )
      )
      setPropriedadesCompartilhadas(
        snap.docs.map(d => ({
          propriedadeId: d.data().propriedadeId,
          permissoes: d.data().permissoes || [],
        }))
      )
    } catch {
      setPropriedadesCompartilhadas([])
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setUsuario(user)
      if (user) {
        executarCatchUpDepreciacao(user.uid)
        await carregarCompartilhadas(user.email)
      } else {
        setPropriedadesCompartilhadas([])
      }
    })
    return unsub
  }, [])

  return (
    <AuthContext.Provider value={{ usuario, propriedadesCompartilhadas, carregarCompartilhadas }}>
      {usuario !== undefined && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}