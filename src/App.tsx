import { AppUpdateWatcher } from './components/AppUpdateWatcher'
import { MaintenanceGate } from './components/MaintenanceGate'
import { AuthProvider } from './hooks/useAuth'
import { AppRoutes } from './routes/AppRoutes'

export default function App() {
  return (
    <AuthProvider>
      <AppUpdateWatcher />
      <MaintenanceGate>
        <AppRoutes />
      </MaintenanceGate>
    </AuthProvider>
  )
}
