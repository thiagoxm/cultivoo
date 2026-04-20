import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Cadastro from './pages/Cadastro'
import Dashboard from './pages/Dashboard'
import Propriedades from './pages/Propriedades'
import Lavouras from './pages/Lavouras'
import Safras from './pages/Safras'
import Patrimonio from './pages/Patrimonio'
import Financeiro from './pages/Financeiro'
import Layout from './components/Layout'
import Configuracoes from './pages/Configuracoes'
import Producao from './pages/Producao'
import Estoque from './pages/Estoque'
import EstoqueProducao from './pages/EstoqueProducao'
import Indicadores from './pages/Indicadores'
import { useCustoProducaoBackground } from './hooks/useCustoProducao'

function RotaProtegida({ children }) {
  const { usuario } = useAuth()
  useCustoProducaoBackground(usuario?.uid)
  return usuario ? children : <Navigate to="/login" />  
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/" element={<RotaProtegida><Layout /></RotaProtegida>}>
          <Route index element={<Dashboard />} />
          <Route path="propriedades" element={<Propriedades />} />
          <Route path="lavouras" element={<Lavouras />} />
          <Route path="safras" element={<Safras />} />
          <Route path="producao" element={<Producao />} />
          <Route path="patrimonio" element={<Patrimonio />} />
          <Route path="financeiro" element={<Financeiro />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="/estoque-producao" element={<EstoqueProducao />} />
          <Route path="/indicadores" element={<Indicadores />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}