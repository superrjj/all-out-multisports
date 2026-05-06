export type UserRole = 'cyclist' | 'admin'

export interface UserProfile {
  id: string
  email: string
  full_name: string
  role: UserRole
  city?: string
}

export type RaceType = string

export interface Event {
  id: string
  title: string
  description: string
  race_type: RaceType
  venue: string
  event_date: string
  registration_fee: number
  poster_url?: string
  prize_pool?: string
  route_map_url?: string
  elevation_profile_url?: string
  status: 'draft' | 'published' | 'completed'
  /** Event day range (from DB). */
  start_date?: string | null
  end_date?: string | null
  /** Registration closes (from DB). */
  registration_deadline?: string | null
  registration_closes_at?: string | null
}
