import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Loading } from './lib/ui';
import { cfg } from './lib/supabase';
import { Shell } from './components/Shell';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectPage from './pages/project/ProjectPage';
import Notifications from './pages/Notifications';
import Me from './pages/Me';
import Users from './pages/admin/Users';
import Companies from './pages/admin/Companies';
import { FieldShell } from './pages/field/FieldShell';
import FieldToday from './pages/field/FieldToday';
import FieldQty from './pages/field/FieldQty';
import FieldPhoto from './pages/field/FieldPhoto';
import FieldMaterial from './pages/field/FieldMaterial';
import FieldRequests from './pages/field/FieldRequests';
import FieldMeeting from './pages/field/FieldMeeting';

function Gate() {
  const { session, profile, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (!cfg.SUPABASE_ANON_KEY) return <div className="spin">설정이 비어 있습니다. 서버의 .env에 SUPABASE_URL · SUPABASE_ANON_KEY를 넣고 다시 띄워 주세요.</div>;
  if (loading) return <Loading />;
  if (!session) return <Login />;
  if (!profile) return <div className="spin">계정 정보(profiles)가 없습니다. 관리자에게 문의하세요. <button className="link" onClick={() => import('./lib/supabase').then((m) => m.sb.auth.signOut())}>로그아웃</button></div>;
  if (!profile.active) return <div className="spin">사용이 중지된 계정입니다.</div>;
  if (profile.must_change_password) return <ChangePassword forced />;
  const fieldOnly = profile.role === 'field';
  if (fieldOnly && !loc.pathname.startsWith('/field') && loc.pathname !== '/me') return <Navigate to="/field" replace />;

  return (
    <Routes>
      <Route path="/field" element={<FieldShell><FieldToday /></FieldShell>} />
      <Route path="/field/qty" element={<FieldShell title="수량 입력" back="/field"><FieldQty /></FieldShell>} />
      <Route path="/field/photo" element={<FieldShell title="사진" back="/field"><FieldPhoto /></FieldShell>} />
      <Route path="/field/material" element={<FieldShell title="자재" back="/field"><FieldMaterial /></FieldShell>} />
      <Route path="/field/meeting" element={<FieldShell title="회의 기록" back="/field"><FieldMeeting /></FieldShell>} />
      <Route path="/field/requests" element={<FieldShell title="도면 · 알림" back="/field"><FieldRequests /></FieldShell>} />
      <Route path="*" element={<Shell><Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/projects/:id/:tab" element={<ProjectPage />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/me" element={<Me />} />
        {isAdmin && <Route path="/admin/users" element={<Users />} />}
        {isAdmin && <Route path="/admin/companies" element={<Companies />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Shell>} />
    </Routes>
  );
}

export default function App() {
  return <BrowserRouter><AuthProvider><ToastProvider><Gate /></ToastProvider></AuthProvider></BrowserRouter>;
}
