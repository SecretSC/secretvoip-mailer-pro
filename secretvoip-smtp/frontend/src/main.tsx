import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import ForcePassword from './pages/ForcePassword';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/Campaigns';
import CampaignEditor from './pages/CampaignEditor';
import CampaignDetails from './pages/CampaignDetails';
import TransmissionLog from './pages/TransmissionLog';
import Smtp from './pages/Smtp';
import Contacts from './pages/Contacts';
import ImportCsv from './pages/ImportCsv';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import AdminUsers from './pages/AdminUsers';
import AdminClientDetails from './pages/AdminClientDetails';
import AuditLogs from './pages/AuditLogs';
import Templates from './pages/Templates';
import AdminDiagnostics from './pages/AdminDiagnostics';
import './index.css';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/force-password" element={<ProtectedRoute><ForcePassword /></ProtectedRoute>} />

          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/new" element={<CampaignEditor />} />
            <Route path="/campaigns/:id/edit" element={<CampaignEditor />} />
            <Route path="/campaigns/:id" element={<CampaignDetails />} />
            <Route path="/transmission" element={<TransmissionLog />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/smtp" element={<Smtp />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/contacts/import" element={<ImportCsv />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin/users" element={<ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/users/:id" element={<ProtectedRoute adminOnly><AdminClientDetails /></ProtectedRoute>} />
            <Route path="/admin/audit" element={<ProtectedRoute adminOnly><AuditLogs /></ProtectedRoute>} />
            <Route path="/admin/diagnostics" element={<ProtectedRoute adminOnly><AdminDiagnostics /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
