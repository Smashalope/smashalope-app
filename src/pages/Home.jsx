import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Home() {
  const { user, profile, loading, signOut } = useAuth();

  if (loading || (user && !profile)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-base text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const displayName = profile?.username ?? user.email?.split("@")[0] ?? "there";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <h1 className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
        Welcome, {displayName}
      </h1>
      <button
        type="button"
        onClick={() => signOut()}
        className="min-h-11 rounded-lg bg-indigo-600 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        Log out
      </button>
    </div>
  );
}
