import { useEffect, useState } from "react";
import { api, getUser } from "../../api.js";
import { AccountBadge } from "../../components/Badge.jsx";
import ReasonDialog from "../../components/ReasonDialog.jsx";

const EMPTY = { name: "", email: "", password: "" };

export default function AdminAdmins() {
  const me = getUser();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(null);

  async function load() {
    try {
      setRows(await api.adminAdmins());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      await api.adminAddAdmin(form);
      setForm(EMPTY);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Admins</h1>
          <p className="muted">Keep at least two admins so one person can never lock the system.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}

      <div className="card table-card">
        {rows === null && !error ? (
          <p className="muted pad">Loading...</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Account</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((a) => (
                <tr key={a.id}>
                  <td className="strong">
                    {a.name} {a.id === me.id && <span className="muted small">(you)</span>}
                  </td>
                  <td>{a.email}</td>
                  <td>
                    <AccountBadge status={a.status} />
                  </td>
                  <td className="right">
                    {a.id !== me.id && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDialog({ suspend: a.status !== "SUSPENDED", id: a.id, name: a.name })}
                      >
                        {a.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="card form-grid" onSubmit={add}>
        <h3 className="span-2">Add another admin</h3>
        <label>
          Full name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </label>
        <label>
          Password (min 8)
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
        </label>
        {formError && <div className="alert alert-red span-2">{formError}</div>}
        <div className="span-2">
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Create admin"}
          </button>
        </div>
      </form>

      {dialog && (
        <ReasonDialog
          title={`${dialog.suspend ? "Suspend" : "Reactivate"} ${dialog.name}?`}
          confirmLabel={dialog.suspend ? "Suspend account" : "Reactivate account"}
          danger={dialog.suspend}
          onConfirm={(reason) => api.adminSetStatus(dialog.id, dialog.suspend, reason).then(load)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}