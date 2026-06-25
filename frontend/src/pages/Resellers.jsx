import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../auth";
import { Plus, Pencil, Trash2, X, Search, ShieldCheck, User, KeyRound } from "lucide-react";

const ROLE_BADGE = {
  admin:    "bg-purple-50 text-purple-700 border-purple-200",
  reseller: "bg-blue-50 text-blue-700 border-blue-200",
  client:   "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function rolePill(role) {
  return <span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider ${ROLE_BADGE[role] || ""}`}>{role}</span>;
}

function SubUserForm({ initial, onClose, onSaved, allStreams, currentUser }) {
  const editing = !!initial?.id;
  const [email, setEmail] = useState(initial?.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(initial?.role || "client");
  const [name, setName] = useState(initial?.name || "");
  const [streams, setStreams] = useState(initial?.streams_allowed || []);
  const [maxSub, setMaxSub] = useState(initial?.max_sub_users ?? "");
  const [maxClients, setMaxClients] = useState(initial?.max_concurrent_viewers ?? "");
  const [expiresAt, setExpiresAt] = useState(initial?.expires_at ? initial.expires_at.slice(0, 10) : "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredStreams = useMemo(
    () => allStreams.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())),
    [allStreams, q],
  );

  const toggleStream = (name) => {
    setStreams((s) => s.includes(name) ? s.filter((x) => x !== name) : [...s, name]);
  };
  const setAll = (val) => setStreams(val ? filteredStreams.map((s) => s.name) : []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const body = {
        role,
        name,
        streams_allowed: streams,
        max_sub_users: maxSub === "" ? null : Number(maxSub),
        max_concurrent_viewers: maxClients === "" ? null : Number(maxClients),
        expires_at: expiresAt ? new Date(expiresAt + "T23:59:59Z").toISOString() : null,
        notes,
      };
      if (editing) {
        if (password) body.password = password;
        await api.put(`/sub-users/${initial.id}`, body);
      } else {
        await api.post("/sub-users", { email, password, ...body });
      }
      onSaved();
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="sub-user-form">
      <form onSubmit={submit} className="w-full max-w-3xl bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--border)] relative max-h-[90vh] flex flex-col">
        <button type="button" onClick={onClose} className="absolute top-5 right-5 text-[var(--muted)] hover:text-[var(--text)] z-10" data-testid="sub-user-form-close">
          <X className="w-4 h-4" />
        </button>

        <div className="px-7 pt-7 pb-4 border-b border-[var(--border)]">
          <div className="label mb-1">{editing ? "Edit user" : "New sub-user"}</div>
          <h3 className="text-xl font-semibold tracking-tight">{editing ? initial.email : "Create reseller or client"}</h3>
        </div>

        <div className="px-7 py-5 overflow-y-auto space-y-4">
          {/* Role + email + password */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Role</label>
              <select
                data-testid="sub-user-role"
                value={role} onChange={(e) => setRole(e.target.value)}
                disabled={editing}
                className="w-full px-3 py-2.5 text-sm"
              >
                <option value="client">Client</option>
                {(currentUser?.role === "admin" || currentUser?.role === "reseller") && (
                  <option value="reseller">Reseller</option>
                )}
                {currentUser?.role === "admin" && (
                  <option value="admin">Admin</option>
                )}
              </select>
            </div>
            <div className="col-span-8">
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Email</label>
              <input
                data-testid="sub-user-email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                type="email" required disabled={editing}
                className="w-full px-3 py-2.5 text-sm mono disabled:opacity-60"
              />
            </div>
            <div className="col-span-6">
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Display name</label>
              <input
                data-testid="sub-user-name"
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Reseller One"
                className="w-full px-3 py-2.5 text-sm"
              />
            </div>
            <div className="col-span-6">
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">
                Password {editing && <span className="text-[10px] text-[var(--muted)]">(leave empty to keep)</span>}
              </label>
              <input
                data-testid="sub-user-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                type="password" required={!editing} minLength={4}
                className="w-full px-3 py-2.5 text-sm mono"
              />
            </div>
          </div>

          {/* Quotas — admins have no quotas */}
          {role !== "admin" && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Max sub-users</label>
              <input
                data-testid="sub-user-max-sub"
                type="number" min="0" value={maxSub}
                onChange={(e) => setMaxSub(e.target.value)}
                placeholder="unlimited"
                className="w-full px-3 py-2.5 text-sm mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Max concurrent viewers</label>
              <input
                data-testid="sub-user-max-viewers"
                type="number" min="0" value={maxClients}
                onChange={(e) => setMaxClients(e.target.value)}
                placeholder="unlimited"
                className="w-full px-3 py-2.5 text-sm mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Expires</label>
              <input
                data-testid="sub-user-expires"
                type="date" value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2.5 text-sm mono"
              />
            </div>
          </div>
          )}

          {/* Allowed streams — admins have access to all streams */}
          {role !== "admin" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[var(--text-2)]">
                Allowed streams · <span className="text-[var(--muted)]">{streams.length} selected</span>
              </label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setAll(true)} className="text-[11px] text-[var(--primary)] hover:underline">Select all</button>
                <span className="text-[var(--border-strong)]">·</span>
                <button type="button" onClick={() => setAll(false)} className="text-[11px] text-[var(--muted)] hover:underline">Clear</button>
              </div>
            </div>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Filter streams…"
                className="w-full pl-9 pr-3 py-2 text-xs"
              />
            </div>
            <div className="border border-[var(--border)] rounded-lg max-h-60 overflow-y-auto bg-[var(--surface-2)]" data-testid="sub-user-streams-list">
              {filteredStreams.map((s) => (
                <label key={s.name} className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface)] cursor-pointer border-b border-[var(--border)] last:border-0">
                  <input
                    type="checkbox" checked={streams.includes(s.name)}
                    onChange={() => toggleStream(s.name)}
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                  <span className="text-sm font-medium flex-1">{s.name}</span>
                  <span className="mono text-[11px] text-[var(--muted)]">{s.clients ?? 0} viewers</span>
                </label>
              ))}
              {filteredStreams.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">No streams match.</div>
              )}
            </div>
          </div>
          )}

          <div>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Notes</label>
            <textarea
              data-testid="sub-user-notes"
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this user…"
              rows={2}
              className="w-full px-3 py-2 text-sm resize-none"
            />
          </div>

          {err && <div className="px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>}
        </div>

        <div className="px-7 py-4 border-t border-[var(--border)] flex gap-3 justify-end bg-[var(--surface-2)] rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary" data-testid="sub-user-submit">
            {busy ? "Saving…" : editing ? "Save changes" : "Create user"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Resellers() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [streams, setStreams] = useState([]);
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([
        api.get("/sub-users"),
        api.get("/streams"),
      ]);
      setList(u.data || []);
      setStreams(s.data || []);
    } catch (e) {
      console.error("resellers load failed", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.email} and ALL their sub-users? This cannot be undone.`)) return;
    try {
      await api.delete(`/sub-users/${u.id}`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || "Delete failed");
    }
  };

  const filtered = list.filter((u) =>
    u.email.toLowerCase().includes(q.toLowerCase()) ||
    (u.name || "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div data-testid="resellers-page">
      <PageHeader
        title="Resellers & clients"
        subtitle={user?.role === "admin" ? "Tenant accounts under your control" : "Your sub-tree"}
        testId="resellers-header"
        right={
          <button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="btn btn-primary"
            data-testid="new-sub-user-button"
          >
            <Plus className="w-4 h-4" /> New user
          </button>
        }
      />

      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              data-testid="resellers-search"
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search by email or name…"
              className="w-full pl-10 pr-3 py-2.5 text-sm"
            />
          </div>
          <div className="text-xs text-[var(--muted)] mono">{filtered.length} of {list.length}</div>
        </div>

        <div className="cell overflow-hidden" data-testid="resellers-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)]">
                <tr className="text-left label">
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Streams</th>
                  <th className="px-5 py-3 font-semibold">Sub-users cap</th>
                  <th className="px-5 py-3 font-semibold">Viewers cap</th>
                  <th className="px-5 py-3 font-semibold">Expires</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors" data-testid={`sub-user-row-${u.id}`}>
                    <td className="px-5 py-3.5">{rolePill(u.role)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {u.role === "reseller" ? <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary)]" /> : <User className="w-3.5 h-3.5 text-[var(--muted)]" />}
                        <div>
                          <div className="font-medium">{u.name || u.email.split("@")[0]}</div>
                          <div className="text-[11px] text-[var(--muted)] mono">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 mono text-xs">
                      {u.streams_allowed.length === 0 ? <span className="text-[var(--muted)]">none</span> : <>{u.streams_allowed.length} <span className="text-[var(--muted)]">/ {streams.length}</span></>}
                    </td>
                    <td className="px-5 py-3.5 mono text-xs">{u.max_sub_users ?? <span className="text-[var(--muted)]">∞</span>}</td>
                    <td className="px-5 py-3.5 mono text-xs">{u.max_concurrent_viewers ?? <span className="text-[var(--muted)]">∞</span>}</td>
                    <td className="px-5 py-3.5 mono text-xs text-[var(--muted)]">{u.expires_at ? new Date(u.expires_at).toLocaleDateString() : "—"}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => { setEditing(u); setFormOpen(true); }}
                          className="btn-icon" title="Edit"
                          data-testid={`sub-user-edit-${u.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => remove(u)}
                          className="btn-icon btn-icon-danger" title="Delete"
                          data-testid={`sub-user-delete-${u.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-14 text-center text-[var(--muted)]">
                    <KeyRound className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    No sub-users yet. Click <strong>New user</strong> to create your first reseller or client.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {formOpen && (
        <SubUserForm
          initial={editing}
          allStreams={streams}
          currentUser={user}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}
