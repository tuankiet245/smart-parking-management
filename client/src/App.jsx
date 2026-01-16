import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { authService } from './services/auth';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import CustomerPortal from './pages/CustomerPortal';
import AdminPortal from './pages/AdminPortal';
import './App.css';

// Protected Route Component
function ProtectedRoute({ children }) {
    const isAuth = authService.isAuthenticated();
    return isAuth ? children : <Navigate to="/admin/login" />;
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/admin/login" element={<LoginPage />} />
                <Route path="/customer/*" element={<CustomerPortal />} />
                <Route
                    path="/admin/*"
                    element={
                        <ProtectedRoute>
                            <AdminPortal />
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
