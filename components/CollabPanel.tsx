import React, { useEffect, useState } from 'react';
import { Copy, LogIn, LogOut, Radio, ShieldCheck, UserPlus, Users, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { CollabAuthModal } from './CollabAuthModal';

interface CollabActivityEntry {
    id: string;
    timestamp: number;
    message: string;
}

interface CollabPanelProps {
    sessionId: string | null;
    userName: string;
    commandCount: number;
    activity: CollabActivityEntry[];
    onUserNameChange: (name: string) => void;
    onStartSession: () => void;
    onStopSession: () => void;
    onCopyInvite: () => void;
}

const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const CollabPanel: React.FC<CollabPanelProps> = ({
    sessionId,
    userName,
    commandCount,
    activity,
    onUserNameChange,
    onStartSession,
    onStopSession,
    onCopyInvite
}) => {
    const { session, user, isLoading, initialize, signOut } = useAuthStore();
    const [showAuth, setShowAuth] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

    const accountName = (
        user?.user_metadata?.full_name
        || user?.user_metadata?.username
        || user?.email
        || 'Operador HOLLOW bits'
    );

    useEffect(() => {
        const unsubscribe = initialize();
        return () => unsubscribe();
    }, [initialize]);

    useEffect(() => {
        if (!session || !accountName || userName.trim() !== 'Producer') {
            return;
        }

        onUserNameChange(accountName);
    }, [accountName, onUserNameChange, session, userName]);

    const openAuth = (mode: 'login' | 'signup') => {
        setAuthMode(mode);
        setShowAuth(true);
    };

    const handleStartSession = () => {
        if (!session) {
            openAuth('login');
            return;
        }

        onStartSession();
    };

    const handleSignOut = async () => {
        if (sessionId) {
            onStopSession();
        }

        await signOut();
    };

    return (
        <div className="space-y-4">
            <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Modo colaboracion</div>
                <div className="text-xs text-gray-300 leading-relaxed">
                    Host session desktop-first: sincronizacion local para preparar colaboracion remota sin romper estabilidad del proyecto.
                </div>
            </div>

            <div className="rounded-sm border border-daw-violet/20 bg-daw-violet/[0.07] p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-daw-violet">
                            <ShieldCheck size={13} />
                            Cuenta DAW
                        </div>
                        <div className="mt-2 truncate text-sm font-semibold text-white">
                            {isLoading ? 'Verificando sesion...' : session ? accountName : 'Sin sesion de HOLLOW bits'}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-gray-400">
                            {session
                                ? 'Credenciales heredadas del ecosistema hollowbits.com listas para operar el host.'
                                : 'Inicia sesion o registra un operador antes de abrir colaboracion remota.'}
                        </div>
                    </div>

                    {session ? (
                        <button
                            type="button"
                            onClick={handleSignOut}
                            disabled={isLoading}
                            className="h-8 shrink-0 rounded-sm border border-white/10 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-300 transition-colors hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-50"
                        >
                            <span className="flex items-center gap-1.5"><LogOut size={12} /> Salir</span>
                        </button>
                    ) : (
                        <div className="flex shrink-0 gap-2">
                            <button
                                type="button"
                                onClick={() => openAuth('login')}
                                disabled={isLoading}
                                className="h-8 rounded-sm border border-white/10 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-200 transition-colors hover:border-white/25 disabled:opacity-50"
                            >
                                <span className="flex items-center gap-1.5"><LogIn size={12} /> Log in</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => openAuth('signup')}
                                disabled={isLoading}
                                className="h-8 rounded-sm border border-daw-violet/40 bg-daw-violet/15 px-3 text-[10px] font-bold uppercase tracking-wider text-daw-violet transition-colors hover:bg-daw-violet/25 disabled:opacity-50"
                            >
                                <span className="flex items-center gap-1.5"><UserPlus size={12} /> Sign up</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-sm border border-white/10 bg-[#12141b] p-3">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">Nombre en sesion</label>
                    <input
                        value={userName}
                        onChange={(event) => onUserNameChange(event.target.value)}
                        className="mt-2 w-full h-9 bg-[#0b0e14] border border-white/10 rounded-sm px-2 text-xs text-gray-200 focus:outline-none focus:border-daw-cyan/50"
                        placeholder="Producer"
                        disabled={!!session}
                    />
                </div>

                <div className="rounded-sm border border-white/10 bg-[#12141b] p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Estado</div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-200">
                        {sessionId ? <Wifi size={14} className="text-green-400" /> : <WifiOff size={14} className="text-gray-500" />}
                        {sessionId ? 'Sesion activa' : 'Sesion inactiva'}
                    </div>
                    {sessionId && (
                        <div className="mt-2 text-[10px] text-gray-500 font-mono break-all">ID: {sessionId}</div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {!sessionId ? (
                    <button
                        type="button"
                        onClick={handleStartSession}
                        disabled={isLoading}
                        className="h-9 px-4 rounded-sm border border-daw-violet/40 bg-daw-violet/15 hover:bg-daw-violet/25 text-[10px] font-bold uppercase tracking-wider text-daw-violet flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Radio size={12} /> Iniciar sesion host
                    </button>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={onCopyInvite}
                            className="h-9 px-4 rounded-sm border border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] font-bold uppercase tracking-wider text-cyan-200 flex items-center gap-2"
                        >
                            <Copy size={12} /> Copiar invite
                        </button>
                        <button
                            type="button"
                            onClick={onStopSession}
                            className="h-9 px-4 rounded-sm border border-rose-400/40 bg-rose-500/10 hover:bg-rose-500/20 text-[10px] font-bold uppercase tracking-wider text-rose-200"
                        >
                            Cerrar sesion
                        </button>
                    </>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-sm border border-white/10 bg-[#111722] p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Comandos sincronizables</div>
                    <div className="mt-2 text-lg font-bold text-white">{commandCount}</div>
                </div>
                <div className="rounded-sm border border-white/10 bg-[#111722] p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Participantes</div>
                    <div className="mt-2 text-sm font-semibold text-white flex items-center gap-2">
                        <Users size={14} className="text-daw-cyan" /> {sessionId ? '1 (host)' : '0'}
                    </div>
                </div>
            </div>

            <div className="rounded-sm border border-white/10 bg-[#0f1520]">
                <div className="h-9 px-3 border-b border-white/10 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Activity Feed</span>
                    <span className="text-[9px] text-gray-600">{activity.length} eventos</span>
                </div>
                <div className="max-h-[220px] overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                    {activity.length === 0 ? (
                        <div className="text-[10px] text-gray-600 px-1 py-2">Sin actividad de colaboracion aun.</div>
                    ) : (
                        activity.map((entry) => (
                            <div key={entry.id} className="rounded-sm border border-white/5 bg-white/[0.02] px-2 py-1.5">
                                <div className="text-[9px] text-gray-500 font-mono">{formatTime(entry.timestamp)}</div>
                                <div className="text-[10px] text-gray-300">{entry.message}</div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {showAuth && (
                <CollabAuthModal
                    initialMode={authMode}
                    onClose={() => setShowAuth(false)}
                    onSuccess={() => {
                        setShowAuth(false);
                        onStartSession();
                    }}
                />
            )}
        </div>
    );
};

export type { CollabActivityEntry };
export default CollabPanel;
