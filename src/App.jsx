import { BrowserRouter, Routes, Route } from "react-router-dom";
import DebugReset from "./components/DebugReset.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import Battle from "./pages/Battle.jsx";
import Bracket from "./pages/Bracket.jsx";
import SmashalopeDashboard from "./pages/SmashalopeDashboard.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Battle />} />
          <Route path="/bracket" element={<Bracket />} />
          <Route path="/smashalope" element={<SmashalopeDashboard />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
        </Routes>
        <DebugReset />
      </AuthProvider>
    </BrowserRouter>
  );
}
