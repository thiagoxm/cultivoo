import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, query, where, getDocs, setDoc, doc } from 'firebase/firestore'
import { auth, db } from '../services/firebase'
import { executarCatchUpDepreciacao } from '../services/depreciacao'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined)
  const [propriedadesCompartilhadas, setPropriedadesCompartilhadas] = useState([])

  async function carregarCompartilhadas(user) {
    try {
      const snap = await getDocs(
        query(
          collection(db, 'convites'),
          where('emailConvidado', '==', user.email),
          where('status', '==', 'aceito')
        )
      )
      const compartilhadas = snap.docs.map(d => ({
        propriedadeId: d.data().propriedadeId,
        permissoes: d.data().permissoes || [],
        nivel: d.data().nivel || 'operacional',
      }))
      setPropriedadesCompartilhadas(compartilhadas)

      // Gravar coleção 'acessos' para uso nas Firestore Rules
      const propriedadeIds = compartilhadas.map(c => c.propriedadeId)
      await setDoc(doc(db, 'acessos', user.uid), {
        uid: user.uid,
        email: user.email,
        propriedadeIds,
        atualizadoEm: new Date(),
      })
    } catch {
      setPropriedadesCompartilhadas([])
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setUsuario(user)
      if (user) {
        executarCatchUpDepreciacao(user.uid)
        await carregarCompartilhadas(user)
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
