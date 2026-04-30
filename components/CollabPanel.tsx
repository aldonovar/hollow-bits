import React from 'react';
import { Copy, Radio, Users, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { CollabAuthModal } from './CollabAuthModal';
import { useState, useEffect } from 'react';

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
    const { session, user, initialize } = useAuthStore();
    const [showAuth, setShowAuth] = useState(false);

    useEffect(() => {
        const unsubscribe = initialize();
        return () => unsubscribe();
    }, [initialize]);

    const handleStartSession = () => {
        if (!session) {
            setShowAuth(true);
        } else {
            onStartSession();
        }
    };

    const handleStopSession = () => {
        onStopSession();
    };

    return (
        <div className="space-y-4">
            <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Modo colaboracion</div>
                <div className="text-xs text-gray-300 leading-relaxed">
                    Host session desktop-first: sincronizacion local para preparar colaboracion remota sin romper estabilidad del proyecto.
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
                        onClick={handleStartSession}
                        className="h-9 px-4 rounded-sm border border-daw-violet/40 bg-daw-violet/15 hover:bg-daw-violet/25 text-[10px] font-bold uppercase tracking-wider text-daw-violet flex items-center gap-2"
                    >
                        <Radio size={12} /> Iniciar sesion host
                    </button>
                ) : (
                    <>
                        <button
                            onClick={onCopyInvite}
                            className="h-9 px-4 rounded-sm border border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] font-bold uppercase tracking-wider text-cyan-200 flex items-center gap-2"
                        >
                            <Copy size={12} /> Copiar invite
                        </button>
                        <button
                            onClick={handleStopSession}
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
