import React from 'react';

export function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="err">{error}</small>}
    </label>
  );
}

export const fieldErrors = (e) => Object.fromEntries((e?.errors || []).map((x) => [x.field, x.message]));
