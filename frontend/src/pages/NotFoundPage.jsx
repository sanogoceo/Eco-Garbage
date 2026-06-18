import { Link } from 'react-router-dom'
import { Leaf, MoveLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function NotFoundPage() {
  const { user } = useAuth()
  const home = user?.role === 'admin'
    ? '/admin'
    : user?.role === 'collector'
      ? '/collector'
      : user
        ? '/dashboard'
        : '/'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f7faf8] p-6 text-center">
      <div className="w-20 h-20 bg-[#E8F5EE] rounded-2xl flex items-center justify-center mb-6">
        <Leaf size={36} className="text-[#1A8A3C]" />
      </div>
      <p className="text-7xl font-display font-black text-[#1A8A3C] mb-2">404</p>
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">Page introuvable</h1>
      <p className="text-gray-500 max-w-sm mb-8">
        Cette page n'existe pas ou a été déplacée. Vérifiez l'adresse ou retournez à l'accueil.
      </p>
      <Link to={home} className="btn-primary gap-2">
        <MoveLeft size={16} />
        Retour à l'accueil
      </Link>
    </div>
  )
}
