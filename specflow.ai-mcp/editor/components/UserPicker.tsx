'use client'

import { useRouter } from 'next/navigation'
import { MOCK_USERS } from '@/lib/users'

export default function UserPicker() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        {/* Logo / title */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-900">SpecFlowIA</h1>
          <p className="text-sm text-gray-500 mt-1">Selecione o usuário para continuar</p>
        </div>

        {/* User cards */}
        <div className="flex flex-col gap-3">
          {MOCK_USERS.map(user => (
            <button
              key={user.id}
              onClick={() => router.push(`/api/select-owner?owner_id=${user.id}`)}
              className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 text-left hover:border-indigo-400 hover:shadow-sm transition"
            >
              <span className="text-3xl">{user.emoji}</span>
              <div>
                <p className="font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">
                  {user.id}
                </p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400">
          Ambiente de testes — IDs hardcoded
        </p>
      </div>
    </div>
  )
}
