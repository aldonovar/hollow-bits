import React, { useState } from 'react';
import { ArrowRight, AlertCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

interface MiniAuthPanelProps {
  onSuccess: () => void;
  onBack: () => void;
}

export const MiniAuthPanel: React.FC<MiniAuthPanelProps> = ({ onSuccess, onBack }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (signInError) {
      if (signInError.message.includes('Invalid login credentials')) {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError(signInError.message);
      }
      setLoading(false);
      return;
    }

    if (data.session) {
      useAuthStore.setState({
        user: data.session.user,
        session: data.session,
        isLoading: false,
      });
      onSuccess();
    } else {
      setError('No se pudo establecer sesión.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="flex items-center gap-2 mb-1">
        <button 
          onClick={onBack}
          className="p-1 text-gray-500 hover:text-white rounded transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">Vincular Cuenta</span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
            <AlertCircle size={12} className="shrink-0" />
            <span className="leading-tight">{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={async () => {
            setLoading(true);
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
              provider: 'google',
              options: {
                redirectTo: `${window.location.origin}/engine`,
                queryParams: { prompt: 'select_account' },
              }
            });
            if (oauthError) {
              setError(oauthError.message);
              setLoading(false);
            }
          }}
          disabled={loading}
          className="w-full py-2 bg-white text-black rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continuar con Google
        </button>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[9px] text-gray-500 uppercase">O con correo</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <div className="flex flex-col gap-1">
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-daw-cyan focus:ring-1 focus:ring-daw-cyan/50 transition-all"
          />
        </div>

        <div className="flex flex-col gap-1">
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-daw-cyan focus:ring-1 focus:ring-daw-cyan/50 transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 mt-1 bg-daw-cyan text-black font-bold text-[10px] uppercase tracking-wider rounded hover:bg-daw-cyan/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <span className="animate-pulse">Accediendo...</span>
          ) : (
            <>
              Iniciar Sesión
              <ArrowRight size={12} />
            </>
          )}
        </button>
      </form>
    </div>
  );
};
