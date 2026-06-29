import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import Formulary from './pages/Formulary';
import CreateOrder from './pages/CreateOrder';
import AwaitingPayment from './pages/AwaitingPayment';
import Orders from './pages/Orders';
import Patients from './pages/Patients';

function AppContent() {
  const { state } = useApp();

  const renderScreen = () => {
    switch (state.screen) {
      case 'home':      return <Dashboard />;
      case 'referrals': return <Referrals />;
      case 'formulary': return <Formulary />;
      case 'create':    return <CreateOrder />;
      case 'review':    return <AwaitingPayment />;
      case 'orders':    return <Orders />;
      case 'patients':  return <Patients />;
      default:          return <Dashboard />;
    }
  };

  return (
    <div className="app-shell">
      <Header />
      <Navigation />
      <div className="page-body">
        {renderScreen()}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
