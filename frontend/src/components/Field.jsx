/**
 * One labelled input plus the server's validation message for that field.
 *
 * Validation is done on the server (zod). Whatever the API returns in
 * error.details is what the user sees here, so the browser never invents a rule
 * the server does not actually enforce.
 */
export function Field({ label, name, error, hint, children }) {
  return (
    <p className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && (
        <span className="field-error" data-testid={`error-${name}`} role="alert">
          {error}
        </span>
      )}
    </p>
  )
}

/** Form-level message: 401/403/409/429/500 and any detail without a field. */
export function FormMessage({ error, success }) {
  if (success) {
    return (
      <p className="notice notice-ok" data-testid="form-success" role="status">
        {success}
      </p>
    )
  }
  if (!error) return null
  return (
    <p className="notice notice-error" data-testid="form-error" role="alert">
      {error}
    </p>
  )
}
