import type { ReactNode } from 'react'
import { SITE_UNDER_MAINTENANCE } from '../lib/siteMaintenance'
import { UnderMaintenancePage } from './UnderMaintenancePage'

export function MaintenanceGate({ children }: { children: ReactNode }) {
  if (!SITE_UNDER_MAINTENANCE) return children
  return <UnderMaintenancePage />
}
