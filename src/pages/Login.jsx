import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const signedUp = location.state?.signedUp;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({ email: "", password: "", form: "" });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({ email: "", password: "", form: "" });

    let emailErr = "";
    let passwordErr = "";
    if (!email.trim()) emailErr = "Email is required.";
    else if (!emailRegex.test(email.trim())) emailErr = "Enter a valid email address.";
    if (!password) passwordErr = "Password is required.";

    if (emailErr || passwordErr) {
      setErrors({ email: emailErr, password: passwordErr, form: "" });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrors((prev) => ({ ...prev, form: error.message }));
        return;
      }

      navigate("/", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "mt-1 block w-full min-h-11 rounded-lg border px-3 py-2 text-base text-gray-900 shadow-sm outline-none ring-offset-white transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 border-gray-300";
  const errorInputClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Log in</h1>
        <p className="mt-2 text-sm text-gray-600 sm:text-base">
          Need an account?{" "}
          <Link to="/signup" className="font-medium text-indigo-600 underline-offset-2 hover:underline">
            Sign up
          </Link>
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
          noValidate
        >
          {signedUp ? (
            <div
              className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
              role="status"
            >
              Account created. You can log in now.
            </div>
          ) : null}

          {errors.form ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              {errors.form}
            </div>
          ) : null}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} ${errors.email ? errorInputClass : ""}`}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "login-email-error" : undefined}
            />
            {errors.email ? (
              <p id="login-email-error" className="mt-1 text-sm text-red-600">
                {errors.email}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} ${errors.password ? errorInputClass : ""}`}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "login-password-error" : undefined}
            />
            {errors.password ? (
              <p id="login-password-error" className="mt-1 text-sm text-red-600">
                {errors.password}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
