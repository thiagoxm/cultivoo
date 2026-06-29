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
      // Um único where para evitar índice composto — filtra status no JS
      const snap = await getDocs(
        query(
          collection(db, 'convites'),
          where('emailConvidado', '==', user.email)
        )
      )
      const compartilhadas = snap.docs
        .filter(d => d.data().status === 'aceito')
        .map(d => ({
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
    } catch (err) {
      console.error('carregarCompartilhadas erro:', err)
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

// Helper: verifica se o usuário pode editar dados de uma propriedade compartilhada
// permissaoPagina: 'lavouras' | 'safras' | 'estoque' | 'estoqueProducao' | 'producao' | 'financeiro' | 'patrimonio'
export function usePodeEditar(propriedadeId, permissaoPagina) {
  const { propriedadesCompartilhadas } = useContext(AuthContext)
  if (!propriedadeId) return true // próprio usuário, pode sempre
  const compartilhado = propriedadesCompartilhadas.find(c => c.propriedadeId === propriedadeId)
  if (!compartilhado) return true // próprio usuário
  return compartilhado.permissoes.includes(permissaoPagina)
}
