import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isUsernameClean } from "../lib/moderation.js";
import { supabase } from "../lib/supabase.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate({ email, password, username, ageConfirmed }) {
  const next = {
    email: "",
    password: "",
    username: "",
    ageConfirm: "",
  };

  if (!email.trim()) next.email = "Email is required.";
  else if (!emailRegex.test(email.trim())) next.email = "Enter a valid email address.";

  if (!password) next.password = "Password is required.";
  else if (password.length < 6) next.password = "Password must be at least 6 characters.";

  const u = username.trim();
  if (!u) next.username = "Username is required.";
  else if (u.length < 2) next.username = "Username must be at least 2 characters.";
  else if (u.length > 32) next.username = "Username must be 32 characters or fewer.";

  if (!ageConfirmed) next.ageConfirm = "You must confirm you are 13 or older.";

  return next;
}

export default function Signup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [errors, setErrors] = useState({
    email: "",
    password: "",
    username: "",
    ageConfirm: "",
    form: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors((prev) => ({ ...prev, form: "" }));

    const fieldErrors = validate({ email, password, username, ageConfirmed });
    const hasFieldError = Object.values(fieldErrors).some(Boolean);
    setErrors((prev) => ({ ...prev, ...fieldErrors }));
    if (hasFieldError) return;

    if (!isUsernameClean(username.trim())) {
      setErrors((prev) => ({
        ...prev,
        username: "That username isn't available. Try another one.",
      }));
      return;
    }

    setSubmitting(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { username: username.trim() },
        },
      });

      if (signUpError) {
        setErrors((prev) => ({
          ...prev,
          form: signUpError.message,
        }));
        return;
      }

      const user = authData.user;
      if (!user?.id) {
        setErrors((prev) => ({
          ...prev,
          form:
            "Could not create your account. If email confirmation is required, check your inbox and try signing in after confirming.",
        }));
        return;
      }

      const { error: profileError } = await supabase.from("profiles").insert({
        id: user.id,
        username: username.trim(),
        age_confirmed: true,
      });

      if (profileError) {
        setErrors((prev) => ({
          ...prev,
          form: profileError.message,
        }));
        return;
      }

      navigate("/login", { replace: true, state: { signedUp: true } });
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
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Create account</h1>
        <p className="mt-2 text-sm text-gray-600 sm:text-base">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-indigo-600 underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
          noValidate
        >
          {errors.form ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              {errors.form}
            </div>
          ) : null}

          <div>
            <label htmlFor="signup-email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} ${errors.email ? errorInputClass : ""}`}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "signup-email-error" : undefined}
            />
            {errors.email ? (
              <p id="signup-email-error" className="mt-1 text-sm text-red-600">
                {errors.email}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="signup-username" className="block text-sm font-medium text-gray-700">
              Username
            </label>
            <input
              id="signup-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${inputClass} ${errors.username ? errorInputClass : ""}`}
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? "signup-username-error" : undefined}
            />
            {errors.username ? (
              <p id="signup-username-error" className="mt-1 text-sm text-red-600">
                {errors.username}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="signup-password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} ${errors.password ? errorInputClass : ""}`}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "signup-password-error" : undefined}
            />
            {errors.password ? (
              <p id="signup-password-error" className="mt-1 text-sm text-red-600">
                {errors.password}
              </p>
            ) : null}
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                aria-invalid={Boolean(errors.ageConfirm)}
                aria-describedby={errors.ageConfirm ? "signup-age-error" : undefined}
              />
              <span className="text-sm text-gray-700">I confirm I am 13 or older</span>
            </label>
            {errors.ageConfirm ? (
              <p id="signup-age-error" className="mt-1 text-sm text-red-600">
                {errors.ageConfirm}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Sign up"}
          </button>
        </form>
      </div>
    </div>
  );
}
