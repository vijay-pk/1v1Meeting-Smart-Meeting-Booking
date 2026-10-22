import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  GraduationCap, UserPlus, RefreshCw, Mail, Power, FileText, Loader2, X, Check, AlertCircle,
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

  const load = () => {
    setLoading(true);
    api.saStudentsList().then(setStudents).catch((e) => setError(e?.message || 'Could not load students.')).finally(() => setLoading(false));
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
    try { const r = await api.saStudentResendCredentials(id); alert(r?.sent ? 'Credentials email sent.' : 'Email not sent (check email configuration).'); load(); }
    catch (e: any) { alert(e?.message || 'Could not resend.'); }
    finally { setBusyId(null); }
  };

  const openReport = async (s: Student) => {
    setBusyId(s.id);
    try { const r = await api.saStudentReport(s.id, false); setReport({ id: s.id, name: s.name, html: r.html }); }
    catch (e: any) { alert(e?.message || 'Could not generate report.'); }
    finally { setBusyId(null); }
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
            <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Free meetings" type="number" min={0} value={allocated} onChange={(e) => setAllocated(Number(e.target.value))} />
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
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" className="h-8 px-2" title="Resend credentials" disabled={busyId === s.id} onClick={() => resend(s.id)}><Mail className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2" title="Report" disabled={busyId === s.id} onClick={() => openReport(s)}><FileText className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className={`h-8 px-2 ${s.status === 'ACTIVE' ? 'text-amber-700' : 'text-emerald-700'}`} title={s.status === 'ACTIVE' ? 'Disable' : 'Enable'} disabled={busyId === s.id} onClick={() => toggleStatus(s)}><Power className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
