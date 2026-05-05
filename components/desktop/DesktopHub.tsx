import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  Cloud,
  CloudOff,
  Copy,
  FolderOpen,
  LogOut,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Settings,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import AppLogo from '../AppLogo';
import { platformService } from '../../services/platformService';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import type { Project } from '../../types/supabase';

type HubTab = 'personal' | 'shared' | 'teams';

interface WorkspaceSummary {
  id: string;
  created_by: string;
  category: string | null;
  name?: string | null;
  slug?: string | null;
}

interface DesktopHubProps {
  refreshSignal: number;
  onLogin: () => void;
  onSignup: () => void;
  onSettings: () => void;
}

interface NotificationRecord {
  id: string;
  type: string;
  status: string;
  project_id: string | null;
  team_id: string | null;
  message: string | null;
  created_at: string | null;
  sender_id: string | null;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Ahora mismo';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours}h`;
  if (diffDays < 7) return `Hace ${diffDays}d`;
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function NotificationsMenu() {
  const { user } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('user_notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setNotifications(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchNotifications();

    const channel = supabase
      .channel('public:user_notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` },
        (payload) => setNotifications((current) => [payload.new as NotificationRecord, ...current])
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleResponse = async (id: string, status: 'accepted' | 'declined', notification: NotificationRecord) => {
    if (!user) return;
    await supabase.from('user_notifications').update({ status }).eq('id', id);
    setNotifications((current) => current.map((entry) => entry.id === id ? { ...entry, status } : entry));

    if (status !== 'accepted') return;

    if (notification.type === 'project_invite' && notification.project_id) {
      await supabase.from('project_shares').insert({
        project_id: notification.project_id,
        access_level: 'editor',
        invited_email: user.email,
        token: crypto.randomUUID(),
      });
    }

    if (notification.type === 'team_invite' && notification.team_id) {
      await supabase.from('workspace_members').insert({
        workspace_id: notification.team_id,
        user_id: user.id,
        role: 'editor',
      });
    }
  };

  const pendingCount = notifications.filter((entry) => entry.status === 'pending').length;

  return (
    <div className="desktop-menu-wrap" ref={menuRef}>
      <button className="desktop-btn" onClick={() => setIsOpen((value) => !value)} title="Notificaciones">
        <Bell size={15} /> {pendingCount > 0 ? pendingCount : ''}
      </button>
      {isOpen && (
        <div className="desktop-menu" style={{ width: 330 }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--desktop-border)' }}>
            <strong>Notificaciones</strong>
            <p className="desktop-meta" style={{ margin: '4px 0 0' }}>{pendingCount} pendientes</p>
          </div>
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            {loading ? (
              <p className="desktop-meta" style={{ padding: 16 }}>Cargando...</p>
            ) : notifications.length === 0 ? (
              <p className="desktop-meta" style={{ padding: 16 }}>No tienes notificaciones.</p>
            ) : notifications.map((notification) => (
              <div key={notification.id} style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.06)', opacity: notification.status === 'pending' ? 1 : 0.62 }}>
                <p style={{ margin: 0, fontSize: 13 }}>{notification.message}</p>
                <div className="desktop-row" style={{ marginTop: 10 }}>
                  <span className="desktop-meta">{notification.created_at ? new Date(notification.created_at).toLocaleDateString('es-MX') : ''}</span>
                  {notification.status === 'pending' ? (
                    <div className="desktop-row">
                      <button onClick={() => handleResponse(notification.id, 'declined', notification)} title="Rechazar"><X size={14} /></button>
                      <button onClick={() => handleResponse(notification.id, 'accepted', notification)} title="Aceptar"><Check size={14} /></button>
                    </div>
                  ) : (
                    <span className="desktop-meta">{notification.status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTeamModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { user } = useAuthStore();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Band');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !user) return;
    setLoading(true);
    setError(null);

    try {
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
      const { data: workspace, error: createError } = await supabase
        .from('workspaces')
        .insert([{ name: name.trim(), slug, created_by: user.id, category }])
        .select()
        .single();
      if (createError) throw createError;

      const { error: memberError } = await supabase
        .from('workspace_members')
        .insert([{ workspace_id: workspace.id, user_id: user.id, role: 'owner' }]);
      if (memberError) throw memberError;

      onSuccess();
    } catch (error: any) {
      setError(error?.message || 'Error al crear equipo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="desktop-modal-backdrop">
      <div className="desktop-modal">
        <div className="desktop-row">
          <h3 style={{ margin: 0 }}>Crear equipo</h3>
          <button className="desktop-btn" onClick={onClose}><X size={15} /></button>
        </div>
        {error && <div className="desktop-feedback">{error}</div>}
        <label className="desktop-field">
          <span>Nombre del equipo</span>
          <input className="desktop-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Mi Banda" />
        </label>
        <label className="desktop-field">
          <span>Categoria</span>
          <select className="desktop-select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="Band">Banda</option>
            <option value="Label">Sello Discografico</option>
            <option value="Studio">Estudio</option>
            <option value="Educational">Educativo</option>
            <option value="Other">Otro</option>
          </select>
        </label>
        <div className="desktop-row" style={{ justifyContent: 'flex-end' }}>
          <button className="desktop-btn" onClick={onClose}>Cancelar</button>
          <button className="desktop-btn desktop-btn--primary" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? 'Creando...' : 'Crear equipo'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteUserModal({
  contextName,
  onClose,
  projectId,
  teamId,
}: {
  contextName: string;
  onClose: () => void;
  projectId?: string;
  teamId?: string;
}) {
  const { user } = useAuthStore();
  const [target, setTarget] = useState('');
  const [role, setRole] = useState('editor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleInvite = async () => {
    if (!target.trim() || !user) return;
    setLoading(true);
    setError(null);

    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .or(`username.eq.${target.trim()},full_name.eq.${target.trim()}`)
        .limit(1)
        .single();
      if (profileError || !profileData) throw new Error('No se encontro un usuario con ese identificador.');

      const { error: inviteError } = await supabase
        .from('user_notifications')
        .insert([{
          user_id: profileData.id,
          sender_id: user.id,
          type: teamId ? 'team_invite' : 'project_invite',
          status: 'pending',
          team_id: teamId || null,
          project_id: projectId || null,
          message: `Has sido invitado a colaborar en ${contextName} como ${role}.`,
        }]);
      if (inviteError) throw inviteError;

      setSuccess(true);
      window.setTimeout(onClose, 1600);
    } catch (error: any) {
      setError(error?.message || 'Error al enviar invitacion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="desktop-modal-backdrop">
      <div className="desktop-modal">
        <div className="desktop-row">
          <div>
            <h3 style={{ margin: 0 }}>Invitar usuario</h3>
            <p className="desktop-meta">a {contextName}</p>
          </div>
          <button className="desktop-btn" onClick={onClose}><X size={15} /></button>
        </div>
        {error && <div className="desktop-feedback">{error}</div>}
        {success && <div className="desktop-feedback desktop-feedback--success">Invitacion enviada.</div>}
        <label className="desktop-field">
          <span>Usuario exacto</span>
          <input className="desktop-input" value={target} onChange={(event) => setTarget(event.target.value)} disabled={success} />
        </label>
        {teamId && (
          <label className="desktop-field">
            <span>Rol</span>
            <select className="desktop-select" value={role} onChange={(event) => setRole(event.target.value)} disabled={success}>
              <option value="viewer">Lector</option>
              <option value="editor">Editor</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
        )}
        <div className="desktop-row" style={{ justifyContent: 'flex-end' }}>
          <button className="desktop-btn" onClick={onClose}>{success ? 'Cerrar' : 'Cancelar'}</button>
          {!success && (
            <button className="desktop-btn desktop-btn--primary" onClick={handleInvite} disabled={loading || !target.trim()}>
              {loading ? 'Enviando...' : 'Invitar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DesktopHub({ refreshSignal, onLogin, onSettings, onSignup }: DesktopHubProps) {
  const { user, profile, signOut, isLoading } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeTab, setActiveTab] = useState<HubTab>('personal');
  const [loading, setLoading] = useState(false);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [inviteContext, setInviteContext] = useState<{ type: 'team' | 'project'; id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFetchingRef = useRef(false);

  const fetchProjects = useCallback(async () => {
    if (!user || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);

    try {
      const { data: memberships, error } = await supabase
        .from('workspace_members')
        .select('workspace_id, workspaces(created_by, category, name, slug)')
        .eq('user_id', user.id);

      if (error || !memberships || memberships.length === 0) {
        setProjects([]);
        setWorkspaces([]);
        return;
      }

      const workspaceMap = new Map<string, WorkspaceSummary>();
      (memberships as any[]).forEach((membership) => {
        if (membership.workspaces) {
          workspaceMap.set(membership.workspace_id, { id: membership.workspace_id, ...membership.workspaces });
        }
      });
      setWorkspaces(Array.from(workspaceMap.values()));

      const workspaceIds = memberships.map((membership) => membership.workspace_id);
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .in('workspace_id', workspaceIds)
        .order('updated_at', { ascending: false });

      if (!projectError && projectData) {
        setProjects(projectData as Project[]);
      }
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      void fetchProjects();
    } else {
      setProjects([]);
      setWorkspaces([]);
    }
  }, [fetchProjects, refreshSignal, user]);

  useEffect(() => {
    const handleClick = () => setContextMenuId(null);
    if (contextMenuId) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
    return undefined;
  }, [contextMenuId]);

  const filteredProjects = useMemo(() => {
    if (activeTab === 'personal') {
      const ids = workspaces.filter((workspace) => workspace.created_by === user?.id && (!workspace.category || workspace.category === 'General')).map((workspace) => workspace.id);
      return projects.filter((project) => ids.includes(project.workspace_id));
    }
    if (activeTab === 'shared') {
      const ids = workspaces.filter((workspace) => workspace.created_by !== user?.id && (!workspace.category || workspace.category === 'General')).map((workspace) => workspace.id);
      return projects.filter((project) => ids.includes(project.workspace_id));
    }
    const ids = workspaces.filter((workspace) => workspace.category && workspace.category !== 'General').map((workspace) => workspace.id);
    return projects.filter((project) => ids.includes(project.workspace_id));
  }, [activeTab, projects, user?.id, workspaces]);

  const displayName = profile?.username || profile?.full_name || user?.email || 'Invitado';
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || null;

  const openEditor = async (projectId?: string) => {
    await platformService.openEditor(projectId ? { projectId } : undefined);
  };

  const createProject = async () => {
    if (!user) {
      await openEditor();
      return;
    }

    const { data: memberships } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1);
    if (!memberships || memberships.length === 0) return;

    const { data, error } = await supabase.rpc('create_project_with_limit', {
      p_name: 'Nuevo Proyecto',
      p_workspace_id: memberships[0].workspace_id,
      p_bpm: 120,
      p_sample_rate: 44100,
      p_is_public: false,
    });

    if (error) {
      alert(error.message.includes('limit reached')
        ? 'Has alcanzado el limite de proyectos para tu plan.'
        : error.message);
      return;
    }

    if (data) {
      await openEditor(data as string);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    setImportingFile(true);

    try {
      const projectData = JSON.parse(await file.text());
      const { data: memberships } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1);
      if (!memberships || memberships.length === 0) throw new Error('No workspace');

      const projectName = projectData.name || file.name.replace(/\.esp$/i, '') || 'Proyecto Importado';
      const { data, error } = await supabase
        .from('projects')
        .insert([{
          name: projectName,
          workspace_id: memberships[0].workspace_id,
          bpm: projectData.bpm || projectData.transport?.bpm || 120,
          sample_rate: projectData.sampleRate || projectData.audioSettings?.sampleRate || 44100,
          data: projectData,
        }])
        .select();
      if (error) throw error;
      if (data) setProjects((current) => [...(data as Project[]), ...current]);
    } catch (error) {
      console.error('[DesktopHub] Import failed:', error);
      alert('Error al importar el archivo. Verifica que sea un .esp valido.');
    } finally {
      setImportingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRename = (project: Project) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
    setContextMenuId(null);
  };

  const confirmRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    const nextName = renameValue.trim();
    const { error } = await supabase
      .from('projects')
      .update({ name: nextName, updated_at: new Date().toISOString() })
      .eq('id', renamingId);
    if (!error) {
      setProjects((current) => current.map((project) => project.id === renamingId ? { ...project, name: nextName } : project));
    }
    setRenamingId(null);
  };

  const duplicateProject = async (project: Project) => {
    if (!user) return;
    setContextMenuId(null);

    const { data: memberships } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1);
    if (!memberships || memberships.length === 0) return;

    const { data, error } = await supabase
      .from('projects')
      .insert([{
        name: `${project.name} (Copia)`,
        workspace_id: memberships[0].workspace_id,
        bpm: project.bpm,
        sample_rate: project.sample_rate,
        data: project.data || {},
      }])
      .select();

    if (!error && data) {
      setProjects((current) => [...(data as Project[]), ...current]);
    }
  };

  const confirmDelete = async (id: string) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (!error) {
      setProjects((current) => current.filter((project) => project.id !== id));
    }
    setDeleteConfirmId(null);
  };

  if (isLoading || loading) {
    return (
      <main className="desktop-hub">
        <div className="desktop-empty">
          <div>
            <div className="desktop-spinner" style={{ margin: '0 auto 18px' }} />
            <p>Cargando ecosistema Hollow Bits...</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="desktop-hub">
      {showCreateTeam && (
        <CreateTeamModal
          onClose={() => setShowCreateTeam(false)}
          onSuccess={() => {
            setShowCreateTeam(false);
            void fetchProjects();
          }}
        />
      )}
      {inviteContext && (
        <InviteUserModal
          contextName={inviteContext.name}
          onClose={() => setInviteContext(null)}
          teamId={inviteContext.type === 'team' ? inviteContext.id : undefined}
          projectId={inviteContext.type === 'project' ? inviteContext.id : undefined}
        />
      )}
      {deleteConfirmId && (
        <div className="desktop-modal-backdrop">
          <div className="desktop-modal">
            <Trash2 size={30} color="var(--desktop-danger)" />
            <h3 style={{ margin: 0 }}>Eliminar proyecto</h3>
            <p className="desktop-kicker">Esta accion es irreversible.</p>
            <div className="desktop-row" style={{ justifyContent: 'flex-end' }}>
              <button className="desktop-btn" onClick={() => setDeleteConfirmId(null)}>Cancelar</button>
              <button className="desktop-btn desktop-btn--danger" onClick={() => confirmDelete(deleteConfirmId)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".esp,.json" style={{ display: 'none' }} onChange={handleImportFile} />

      <section className="desktop-hub__top">
        <div className="desktop-profile">
          {avatarUrl ? (
            <img className="desktop-avatar" src={avatarUrl} alt={displayName} />
          ) : (
            <div className="desktop-avatar">{displayName.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <h1 className="desktop-heading">Motor de Creacion</h1>
            <p className="desktop-kicker">
              {user ? <>Bienvenido, <strong>{displayName}</strong></> : 'Modo invitado para trabajo local'}
              {profile?.tier && profile.tier !== 'free' ? <span className="desktop-meta"> · {profile.tier}</span> : null}
            </p>
          </div>
        </div>

        <div className="desktop-actions">
          {user ? (
            <>
              <NotificationsMenu />
              <button className="desktop-btn" onClick={() => fileInputRef.current?.click()} disabled={importingFile}>
                <Upload size={15} /> {importingFile ? 'Importando...' : 'Importar .esp'}
              </button>
              <button className="desktop-btn" onClick={() => openEditor()}>
                <Play size={15} /> Abrir motor DAW
              </button>
              <button className="desktop-btn desktop-btn--primary" onClick={createProject}>
                <Plus size={15} /> Nuevo proyecto
              </button>
              {activeTab === 'teams' && (
                <button className="desktop-btn" onClick={() => setShowCreateTeam(true)}>
                  <Cloud size={15} /> Crear equipo
                </button>
              )}
              <button className="desktop-btn" onClick={onSettings} title="Configuracion"><Settings size={15} /></button>
              <button className="desktop-btn desktop-btn--danger" onClick={() => signOut()} title="Cerrar sesion"><LogOut size={15} /></button>
            </>
          ) : (
            <>
              <button className="desktop-btn" onClick={() => openEditor()}>
                <CloudOff size={15} /> Editor local
              </button>
              <button className="desktop-btn" onClick={onLogin}>Iniciar sesion</button>
              <button className="desktop-btn desktop-btn--primary" onClick={onSignup}>Crear cuenta</button>
            </>
          )}
        </div>
      </section>

      {user ? (
        <>
          <div className="desktop-tabs">
            {[
              { id: 'personal' as const, label: 'Mis Proyectos', icon: <FolderOpen size={15} /> },
              { id: 'shared' as const, label: 'Colaborativos', icon: <Users size={15} /> },
              { id: 'teams' as const, label: 'Equipos', icon: <Cloud size={15} /> },
            ].map((tab) => (
              <button key={tab.id} className={`desktop-tab ${activeTab === tab.id ? 'is-active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          <div className="desktop-grid">
            {filteredProjects.length === 0 ? (
              <div className="desktop-empty">
                <div>
                  <AppLogo size={48} />
                  <p>No hay proyectos en esta seccion.</p>
                  {activeTab === 'personal' && <button className="desktop-btn desktop-btn--primary" onClick={createProject}><Plus size={15} /> Crear primer proyecto</button>}
                  {activeTab === 'teams' && <button className="desktop-btn" onClick={() => setShowCreateTeam(true)}><Cloud size={15} /> Crear primer equipo</button>}
                </div>
              </div>
            ) : filteredProjects.map((project) => (
              <article key={project.id} className="desktop-card" onClick={() => openEditor(project.id)}>
                <div className="desktop-card__top">
                  <div className="desktop-row" style={{ minWidth: 0, justifyContent: 'flex-start' }}>
                    <div className="desktop-icon-box"><FolderOpen size={23} /></div>
                    <div style={{ minWidth: 0 }}>
                      {renamingId === project.id ? (
                        <div className="desktop-row" onClick={(event) => event.stopPropagation()}>
                          <input
                            className="desktop-input"
                            value={renameValue}
                            autoFocus
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void confirmRename();
                              if (event.key === 'Escape') setRenamingId(null);
                            }}
                          />
                          <button className="desktop-btn" onClick={confirmRename}><Check size={14} /></button>
                          <button className="desktop-btn" onClick={() => setRenamingId(null)}><X size={14} /></button>
                        </div>
                      ) : (
                        <h3 className="desktop-project-name">{project.name}</h3>
                      )}
                    </div>
                  </div>
                  <div className="desktop-menu-wrap" onClick={(event) => event.stopPropagation()}>
                    <button className="desktop-btn" onClick={() => setContextMenuId((current) => current === project.id ? null : project.id)}><MoreVertical size={15} /></button>
                    {contextMenuId === project.id && (
                      <div className="desktop-menu">
                        <button onClick={() => { setInviteContext({ type: 'project', id: project.id, name: project.name }); setContextMenuId(null); }}><UserPlus size={14} /> Invitar</button>
                        <button onClick={() => startRename(project)}><Pencil size={14} /> Renombrar</button>
                        <button onClick={() => duplicateProject(project)}><Copy size={14} /> Duplicar</button>
                        <button onClick={() => { setDeleteConfirmId(project.id); setContextMenuId(null); }}><Trash2 size={14} /> Eliminar</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="desktop-card__bottom" style={{ marginTop: 22 }}>
                  <span className="desktop-meta"><Cloud size={11} /> {formatDate(project.updated_at)}</span>
                  <span className="desktop-meta">{project.bpm} BPM · {(project.sample_rate / 1000).toFixed(1)}kHz</span>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="desktop-empty">
          <div>
            <AppLogo size={54} withGlow />
            <h2>Hub listo para el ecosistema cloud</h2>
            <p>Inicia sesion para ver proyectos, equipos, licencias y notificaciones. El editor local sigue disponible para trabajo offline.</p>
            <div className="desktop-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
              <button className="desktop-btn" onClick={() => openEditor()}><Play size={15} /> Abrir editor local</button>
              <button className="desktop-btn desktop-btn--primary" onClick={onLogin}>Conectar cuenta</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
