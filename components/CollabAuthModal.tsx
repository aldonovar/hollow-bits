import React, { useState } from 'react';
import { ArrowRight, X, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import './Auth.css';

interface CollabAuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const CollabAuthModal: React.FC<CollabAuthModalProps> = ({ onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          setError('El correo o la contraseña son incorrectos.');
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
        setError('No se pudo establecer sesión. Intenta de nuevo.');
      }
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error inesperado de red. Verifica tu conexión.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const callbackUrl = `${window.location.origin}/engine`; // Regresar al DAW
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
          queryParams: {
            prompt: 'select_account',
          },
        }
      });

      if (oauthError) {
        setError(oauthError.message);
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error inesperado de red. Verifica tu conexión.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="auth-card" style={{ maxWidth: '440px', padding: '48px', margin: 0 }}>
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors z-20"
        >
          <X size={20} />
        </button>

        <div className="auth-card__glitch-bar" />
        <div className="auth-card__header">
          <img src="/logo-sphere.svg" alt="HOLLOW bits" className="auth-card__logo" />
          <h1 className="auth-card__title">Iniciar Sesión</h1>
          <p className="auth-card__subtitle">
            Accede a tu cuenta para sincronizar proyectos DAW
          </p>
        </div>

        <button 
          type="button" 
          className="auth-google-btn"
          onClick={handleGoogleLogin}
          disabled={loading}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continuar con Google
        </button>

        <div className="auth-divider">
          <span>o ingresa con tu correo</span>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="auth-form__error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="auth-form__group">
            <label>Correo Electrónico</label>
            <div className="auth-form__input-wrapper">
              <div className="auth-form__icon" style={{ display: 'flex', alignItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              </div>
              <input
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="auth-form__group">
            <label>Contraseña</label>
            <div className="auth-form__input-wrapper">
              <div className="auth-form__icon" style={{ display: 'flex', alignItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            className="auth-form__submit"
            disabled={loading}
          >
            {loading ? (
              <div className="auth-form__loading">
                <div className="auth-form__spinner" />
                <span>ACCEDIENDO...</span>
              </div>
            ) : (
              <>
                <span>INICIAR SESIÓN</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
};

