import { AppUpdateWatcher } from './components/AppUpdateWatcher'
import { AuthProvider } from './hooks/useAuth'
import { AppRoutes } from './routes/AppRoutes'

export default function App() {
  return (
    <AuthProvider>
      <AppUpdateWatcher />
      <AppRoutes />
    </AuthProvider>
  )
}
