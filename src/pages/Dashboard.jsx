import { useEffect, useState } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../contexts/AuthContext'
import { DollarSign, MapPin, Sprout, Tractor, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'

export default function Dashboard() {
  const { usuario } = useAuth()
  const [dados, setDados] = useState({
    propriedades: 0, lavouras: 0, patrimonio: 0,
    receitas: 0, despesas: 0, alertas: []
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function carregar() {
      const uid = usuario.uid
      const q = (col) => query(collection(db, col), where('uid', '==', uid))

      const [props, lavs, pats, fins] = await Promise.all([
        getDocs(q('propriedades')),
        getDocs(q('lavouras')),
        getDocs(q('patrimonios')),
        getDocs(q('financeiro')),
      ])

      const hoje = new Date()
      const em7dias = new Date(hoje)
      em7dias.setDate(hoje.getDate() + 7)

      let receitas = 0, despesas = 0, alertas = []
      fins.forEach(doc => {
        const d = doc.data()
        const valor = Number(d.valor) || 0
        if (d.tipo === 'receita') receitas += valor
        else despesas += valor

        if (d.vencimento && (d.status === 'pendente')) {
          const venc = d.vencimento.toDate ? d.vencimento.toDate() : new Date(d.vencimento)
          if (venc <= em7dias) {
            const diff = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24))
            alertas.push({ ...d, id: doc.id, diasRestantes: diff })
          }
        }
      })

      let totalPatrimonio = 0
      pats.forEach(doc => { totalPatrimonio += Number(doc.data().valor) || 0 })

      setDados({
        propriedades: props.size,
        lavouras: lavs.size,
        patrimonio: totalPatrimonio,
        receitas, despesas, alertas
      })
      setLoading(false)
    }
    carregar()
  }, [usuario])

  const saldo = dados.receitas - dados.despesas

  const cards = [
    { label: 'Propriedades', valor: dados.propriedades, icon: MapPin, cor: 'bg-green-100 text-green-700' },
    { label: 'Lavouras', valor: dados.lavouras, icon: Sprout, cor: 'bg-lime-100 text-lime-700' },
    { label: 'Patrimônio', valor: `R$ ${dados.patrimonio.toLocaleString('pt-BR')}`, icon: Tractor, cor: 'bg-amber-100 text-amber-700' },
    { label: 'Saldo do mês', valor: `R$ ${saldo.toLocaleString('pt-BR')}`, icon: DollarSign, cor: saldo >= 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700' },
  ]

  if (loading) return <div className="text-gray-400 text-sm">Carregando...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(({ label, valor, icon: Icon, cor }) => (
          <div key={label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${cor}`}>
              <Icon size={20} />
            </div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-bold text-gray-800">{valor}</p>
          </div>
        ))}
      </div>

      {/* Receitas x Despesas */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h2 className="font-semibold text-gray-700 mb-4">Resumo financeiro</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Receitas</p>
              <p className="font-bold text-green-600">R$ {dados.receitas.toLocaleString('pt-BR')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <TrendingDown size={20} className="text-red-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Despesas</p>
              <p className="font-bold text-red-500">R$ {dados.despesas.toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alertas */}
      {dados.alertas.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-orange-200">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle size={18} className="text-orange-500" />
            <h2 className="font-semibold text-gray-700">Vencimentos próximos</h2>
          </div>
          <div className="space-y-3">
            {dados.alertas.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-orange-50 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{a.descricao}</p>
                  <p className="text-xs text-gray-500">R$ {Number(a.valor).toLocaleString('pt-BR')}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  a.diasRestantes <= 3 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                }`}>
                  {a.diasRestantes <= 0 ? 'Vencido' : `${a.diasRestantes}d`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dados.alertas.length === 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 text-center text-gray-400 text-sm">
          Nenhum vencimento próximo. Tudo em dia! ✅
        </div>
      )}
    </div>
  )
}
