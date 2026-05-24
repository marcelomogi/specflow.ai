export const MOCK_USERS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'PM Alpha', emoji: '🧑‍💼' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'PM Beta',  emoji: '👩‍💼' },
] as const

export type MockUser = typeof MOCK_USERS[number]

export const OWNER_COOKIE = 'specflowia_owner_id'

export function findUser(id: string): MockUser | undefined {
  return MOCK_USERS.find(u => u.id === id)
}
