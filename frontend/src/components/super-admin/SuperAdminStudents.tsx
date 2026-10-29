import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  GraduationCap, UserPlus, RefreshCw, Mail, Power, FileText, Loader2, X, Check, AlertCircle,
  Eye, MoreVertical, Trash2, ChevronRight, Plus, Minus,
} from 'lucide-react';

type Student = {
  id: string; name: string; email: string; status: string; must_change_password: boolean;
  allocated: number; completed: number; remaining: number; upcoming: number; paid_sessions: number;
  created_at: string | null; credential_email?: { status: string };
};

export const SuperAdminStudents: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [report, setReport] = useState<{ id: string; name: string; html: string } | null>(null);

  // Add form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [allocated, setAllocated] = useState(5);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Allowance edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(0);

  // Row ⋮ menu + details modal
  const [menuId, setMenuId] = useState<string | null>(null);
  const [view, setView] = useState<Student | null>(null);
  const [meetings, setMeetings] = useState<any[] | null>(null);
  const [meetingsLoading, setMeetingsLoading] = useState(false);

  // Inline allowance step controls (±1) on the Allocated card.
  const [stepBusy, setStepBusy] = useState<null | 'add' | 'sub'>(null);
  const [allowErr, setAllowErr] = useState<string | null>(null);
  const [allowOk, setAllowOk] = useState(false);

  const step = async (dir: 'add' | 'sub') => {
    if (!view || stepBusy) return;
    const next = view.allocated + (dir === 'add' ? 1 : -1);
    if (next < 0) return;
    if (next < view.completed) { setAllowErr(`Cannot go below the ${view.completed} already used.`); setTimeout(() => setAllowErr(null), 3000); return; }
    setStepBusy(dir); setAllowErr(null); setAllowOk(false);
    try {
      const u = await api.saStudentAllowance(view.id, next, dir === 'add' ? '+1 meeting' : '-1 meeting');
      // Only on backend success; never optimistic.
      setView({ ...view, allocated: u.allocated, completed: u.completed, remaining: u.remaining });
      load();
      setAllowOk(true);
      setTimeout(() => setAllowOk(false), 2000);
    } catch (e: any) {
      setAllowErr(e?.message || 'Could not update the allowance.');
      setTimeout(() => setAllowErr(null), 4000);
    } finally {
      setStepBusy(null);
    }
  };

  const load = () => {
    setLoading(true);
    setError(null);
    api.saStudentsList()
      .then((rows) => { setStudents(rows); setError(null); })
      .catch((e) => setError(e?.message || 'Could not load students.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    setFormError(null);
    if (!name.trim() || !email.trim()) return setFormError('Name and email are required.');
    setSaving(true);
    try {
      await api.saStudentCreate({ name: name.trim(), email: email.trim(), allocated: Number(allocated) || 0 });
      setName(''); setEmail(''); setAllocated(5); setAdding(false);
      load();
    } catch (e: any) {
      setFormError(e?.message || 'Could not create the student.');
    } finally {
      setSaving(false);
    }
  };

  const saveAllowance = async (id: string) => {
    setBusyId(id);
    try { await api.saStudentAllowance(id, Number(editValue) || 0); setEditId(null); load(); }
    catch (e: any) { alert(e?.message || 'Could not adjust allowance.'); }
    finally { setBusyId(null); }
  };

  const toggleStatus = async (s: Student) => {
    setBusyId(s.id);
    const next = s.status === 'ACTIVE' ? 'TEMPORARILY_DISABLED' : 'ACTIVE';
    try { await api.saStudentStatus(s.id, next); load(); }
    catch (e: any) { alert(e?.message || 'Could not update status.'); }
    finally { setBusyId(null); }
  };

  const resend = async (id: string) => {
    setBusyId(id);
    try {
      let r = await api.saStudentResendCredentials(id);
      if (r?.confirmationRequired) {
        // The backend changed nothing. Only an explicit yes may replace the student's password.
        const why = r.reason === 'student_set_own_password'
          ? 'This student has already chosen their own password. Sending credentials will REPLACE it with the temporary password, sign them out everywhere, and email them the new temporary password.'
          : 'This student still has an older temporary password. Sending credentials will replace it with the current temporary password, sign them out everywhere, and email it to them.';
        if (!window.confirm(`${why}\n\nContinue?`)) return;
        r = await api.saStudentResendCredentials(id, true);
      }
      if (r?.sent) alert('Credentials email sent.');
      else if (r?.password_reset) alert('The password was reset, but the email could not be sent. Use "Send credentials" again to retry.');
      else alert('Email not sent (check email configuration). Use "Send credentials" again to retry.');
      load();
    }
    catch (e: any) { alert(e?.message || 'Could not resend.'); }
    finally { setBusyId(null); }
  };

  const openReport = async (s: Student) => {
    setBusyId(s.id);
    try { const r = await api.saStudentReport(s.id, false); setReport({ id: s.id, name: s.name, html: r.html }); }
    catch (e: any) { alert(e?.message || 'Could not generate report.'); }
    finally { setBusyId(null); }
  };

  const del = async (s: Student) => {
    if (!window.confirm(`Delete ${s.name}? Their account and personal data are permanently removed and their email can be reused. Upcoming meetings are cancelled; past bookings and payments are kept as anonymized records. This cannot be undone.`)) return;
    setBusyId(s.id);
    try { await api.saStudentDelete(s.id); setView(null); load(); }
    catch (e: any) { alert(e?.message || 'Could not delete.'); }
    finally { setBusyId(null); }
  };

  const openDetails = async (s: Student) => {
    setView(s); setMeetings(null); setMenuId(null); setMeetingsLoading(true);
    try { setMeetings(await api.saStudentBookings(s.id)); }
    catch { setMeetings([]); }
    finally { setMeetingsLoading(false); }
  };

  const sendReport = async () => {
    if (!report) return;
    setBusyId(report.id);
    try { const r = await api.saStudentReport(report.id, true); alert(r?.sent ? 'Report emailed to the student.' : 'Email not sent (check email configuration).'); setReport(null); }
    catch (e: any) { alert(e?.message || 'Could not send report.'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="bg-surface rounded-xl p-4 sm:p-6 border border-border space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-indigo-600 shrink-0" /> Students
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1"><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
          <Button size="sm" onClick={() => setAdding((v) => !v)} className="gap-1 bg-indigo-600 hover:bg-indigo-700 text-white"><UserPlus className="w-3.5 h-3.5" /> Add student</Button>
        </div>
      </div>

      {adding && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Full name</Label>
              <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Email</Label>
              <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-text-secondary">Number of Classes</Label>
              <Input placeholder="Number of classes" type="number" min={0} value={allocated} onChange={(e) => setAllocated(Number(e.target.value))} />
            </div>
          </div>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {formError}</p>}
          <p className="text-xs text-text-tertiary">A temporary password is emailed to the student; they set their own on first sign-in.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={create} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Creating…</> : 'Create & email credentials'}
            </Button>
          </div>
        </div>
      )}

      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
        : error ? <p className="text-sm text-red-600">{error}</p>
        : students.length === 0 ? <p className="text-sm text-text-tertiary">No students yet.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-tertiary border-b border-border">
                  <th className="py-2 pr-3">Student</th><th className="pr-3">Free (used/left)</th>
                  <th className="pr-3">Upcoming</th><th className="pr-3">Paid</th><th className="pr-3">Status</th><th className="pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 align-top">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-text-primary">{s.name}</div>
                      <div className="text-xs text-text-tertiary">{s.email}</div>
                      {s.must_change_password && <Badge variant="outline" className="mt-1 text-[10px] text-amber-700 border-amber-200 bg-amber-50">temp password</Badge>}
                    </td>
                    <td className="pr-3">
                      {editId === s.id ? (
                        <div className="flex items-center gap-1">
                          <Input type="number" min={0} value={editValue} onChange={(e) => setEditValue(Number(e.target.value))} className="h-8 w-20" />
                          <Button size="sm" className="h-8 px-2 bg-emerald-600 text-white" disabled={busyId === s.id} onClick={() => saveAllowance(s.id)}><Check className="w-3.5 h-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditId(null)}><X className="w-3.5 h-3.5" /></Button>
                        </div>
                      ) : (
                        <button className="text-left hover:underline" onClick={() => { setEditId(s.id); setEditValue(s.allocated); }}>
                          <span className="font-semibold text-text-primary">{s.allocated}</span>{' '}
                          <span className="text-xs text-text-tertiary">({s.completed} used · {s.remaining} left)</span>
                        </button>
                      )}
                    </td>
                    <td className="pr-3 text-text-secondary">{s.upcoming}</td>
                    <td className="pr-3 text-text-secondary">{s.paid_sessions}</td>
                    <td className="pr-3">
                      <Badge variant="outline" className={s.status === 'ACTIVE' ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-slate-600'}>
                        {s.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="pr-3">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-8 w-8 px-0" title="View details" aria-label="View details" onClick={() => openDetails(s)}><ChevronRight className="w-4 h-4" /></Button>
                        <div className="relative">
                          <Button size="sm" variant="ghost" className="h-8 w-8 px-0" aria-label="More actions" onClick={() => setMenuId(menuId === s.id ? null : s.id)}><MoreVertical className="w-4 h-4" /></Button>
                          {menuId === s.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                              <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-surface py-1 shadow-lg text-left">
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary" onClick={() => openDetails(s)}><Eye className="w-3.5 h-3.5" /> View details</button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary" onClick={() => { setMenuId(null); toggleStatus(s); }}><Power className="w-3.5 h-3.5" /> {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary" onClick={() => { setMenuId(null); setEditId(s.id); setEditValue(s.allocated); }}><GraduationCap className="w-3.5 h-3.5" /> Adjust allowance</button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary" onClick={() => { setMenuId(null); resend(s.id); }}><Mail className="w-3.5 h-3.5" /> Send credentials</button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary" onClick={() => { setMenuId(null); openReport(s); }}><FileText className="w-3.5 h-3.5" /> Report</button>
                                <button className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50" onClick={() => { setMenuId(null); del(s); }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {view && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setView(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-surface p-5 shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-text-primary">{view.name}</h3>
                <p className="text-xs text-text-tertiary">{view.email}</p>
              </div>
              <button onClick={() => setView(null)}><X className="w-5 h-5 text-text-tertiary" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-3 text-center">
              <div className="rounded-lg border border-border py-2">
                <div className="flex items-center justify-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-6 w-6 px-0 shrink-0" title="Decrease allowance" aria-label="Decrease allowance"
                    disabled={stepBusy !== null || view.allocated <= view.completed} onClick={() => step('sub')}>
                    {stepBusy === 'sub' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Minus className="w-3 h-3" />}
                  </Button>
                  <span className="w-6 text-lg font-bold text-text-primary tabular-nums">{view.allocated}</span>
                  <Button size="sm" variant="outline" className="h-6 w-6 px-0 shrink-0" title="Increase allowance" aria-label="Increase allowance"
                    disabled={stepBusy !== null} onClick={() => step('add')}>
                    {stepBusy === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  </Button>
                </div>
                <div className="mt-0.5 text-[11px] text-text-tertiary">Allocated</div>
              </div>
              <div className="rounded-lg border border-border py-2">
                <div className="text-lg font-bold text-text-primary">{view.completed}</div>
                <div className="text-[11px] text-text-tertiary">Used</div>
              </div>
              <div className="rounded-lg border border-border py-2">
                <div className="text-lg font-bold text-text-primary">{view.remaining}</div>
                <div className="text-[11px] text-text-tertiary">Remaining</div>
              </div>
            </div>
            {allowErr && <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> {allowErr}</p>}
            {allowOk && <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600"><Check className="w-3.5 h-3.5" /> Allowance updated.</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              <span>Status: <b className={view.status === 'ACTIVE' ? 'text-emerald-600' : 'text-amber-600'}>{view.status === 'ACTIVE' ? 'Active' : 'Disabled'}</b></span>
              <span>Paid bookings: {view.paid_sessions}</span>
              <span>Upcoming: {view.upcoming}</span>
              {view.created_at && <span>Joined: {new Date(view.created_at).toLocaleDateString()}</span>}
            </div>

            <h4 className="mt-4 mb-1 text-xs font-semibold text-text-secondary">Meeting history</h4>
            {meetingsLoading ? <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              : !meetings || meetings.length === 0 ? <p className="text-xs text-text-tertiary">No meetings yet.</p>
              : (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {meetings.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                      <span className="truncate">{m.session_title} · {m.start_time?.slice(0, 16).replace('T', ' ')}</span>
                      <span className="shrink-0 text-text-tertiary">{m.category === 'student_free' ? 'Free' : 'Paid'} · {m.attendance_status || m.status}</span>
                    </div>
                  ))}
                </div>
              )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
              <Button size="sm" variant="outline" onClick={() => toggleStatus(view)}>{view.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => resend(view.id)}><Mail className="w-4 h-4" /> Credentials</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => { setView(null); openReport(view); }}><FileText className="w-4 h-4" /> Report</Button>
              <Button size="sm" variant="outline" className="gap-1 text-red-600 border-red-200 hover:bg-red-50" disabled={busyId === view.id} onClick={() => del(view)}><Trash2 className="w-4 h-4" /> Delete</Button>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReport(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-surface p-5 shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-text-primary">Report — {report.name}</h3>
              <button onClick={() => setReport(null)}><X className="w-5 h-5 text-text-tertiary" /></button>
            </div>
            <div className="prose prose-sm max-w-none py-4" dangerouslySetInnerHTML={{ __html: report.html }} />
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="outline" size="sm" onClick={() => setReport(null)}>Close</Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" disabled={busyId === report.id} onClick={sendReport}>Email to student</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
