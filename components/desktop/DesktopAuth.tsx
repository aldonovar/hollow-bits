import React, { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AlertCircle, ArrowLeft, ArrowRight, AtSign, Lock, Mail, User } from 'lucide-react';
import AppLogo from '../AppLogo';
import { platformService } from '../../services/platformService';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type AuthStatus = 'idle' | 'loading' | 'success' | 'error';

function getDesktopEmailRedirectUrl(): string {
  const url = new URL('https://hollowbits.com/desktop-auth');
  url.searchParams.set('source', 'desktop');
  url.searchParams.set('mode', 'signup');
  url.searchParams.set('return_to', 'hollowbits://auth/callback');
  return url.toString();
}

interface DesktopAuthProps {
  type: 'login' | 'signup';
  onSuccess: () => void;
  onBack: () => void;
  onSwitchType: (type: 'login' | 'signup') => void;
}

export function DesktopAuth({ type, onSuccess, onBack, onSwitchType }: DesktopAuthProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const finishSession = async (session: Session) => {
    useAuthStore.setState({
      user: session.user,
      session,
      isLoading: false,
    });
    await Promise.all([
      useAuthStore.getState().refreshProfile(),
      useAuthStore.getState().checkMfa(),
    ]);
    onSuccess();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage(null);

    const trimmedEmail = email.trim().toLowerCase();

    try {
      if (type === 'signup') {
        if (!fullName.trim() || !username.trim() || !password) {
          setStatus('error');
          setErrorMessage('Completa todos los campos obligatorios.');
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              username: username.trim(),
            },
            emailRedirectTo: getDesktopEmailRedirectUrl(),
          },
        });

        if (error) {
          setStatus('error');
          setErrorMessage(error.message);
          return;
        }

        if (data.session) {
          await finishSession(data.session);
        } else {
          setStatus('success');
        }
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setStatus('error');
        setErrorMessage(error.message.includes('Invalid login credentials')
          ? 'El correo o la contrasena son incorrectos.'
          : error.message);
        return;
      }

      if (data.session) {
        await finishSession(data.session);
      } else {
        setStatus('error');
        setErrorMessage('No se pudo establecer sesion. Intenta de nuevo.');
      }
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error?.message || 'Error inesperado de conexion.');
    }
  };

  const handleGoogleLogin = async () => {
    setStatus('loading');
    setErrorMessage(null);

    try {
      const result = await platformService.openDesktopAuth({
        mode: type,
        prompt: 'select_account',
      });

      if (!result.success) {
        setStatus('error');
        setErrorMessage(result.error || 'No se pudo abrir el puente de autenticacion.');
        return;
      }
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error?.message || 'Error inesperado al abrir Google.');
    }
  };

  if (status === 'success' && type === 'signup') {
    return (
      <div className="desktop-form">
        <div className="desktop-form__header">
          <AppLogo size={52} withGlow />
          <h1>Verifica tu identidad</h1>
          <p className="desktop-kicker">Hemos enviado un correo a {email}</p>
        </div>
        <p className="desktop-kicker" style={{ textAlign: 'center' }}>
          Revisa tu bandeja de entrada y confirma el registro para activar tu cuenta.
        </p>
        <button className="desktop-btn" onClick={() => onSwitchType('login')}>
          Ir a inicio de sesion
        </button>
      </div>
    );
  }

  return (
    <div className="desktop-form">
      <div className="desktop-form__header">
        <AppLogo size={52} withGlow />
        <h1>{type === 'login' ? 'Iniciar Sesion' : 'Registro de Operador'}</h1>
        <p className="desktop-kicker">
          {type === 'login' ? 'Accede a tu consola y proyectos DAW.' : 'Configura tus credenciales del ecosistema.'}
        </p>
      </div>

      <button className="desktop-btn desktop-btn--primary" onClick={handleGoogleLogin} disabled={status === 'loading'}>
        Continuar con Google
      </button>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        {status === 'error' && errorMessage && (
          <div className="desktop-feedback">
            <AlertCircle size={15} /> {errorMessage}
          </div>
        )}

        {type === 'signup' && (
          <>
            <label className="desktop-field">
              <span><User size={13} /> Nombre completo</span>
              <input className="desktop-input" value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={status === 'loading'} required />
            </label>
            <label className="desktop-field">
              <span><AtSign size={13} /> Usuario</span>
              <input className="desktop-input" value={username} onChange={(event) => setUsername(event.target.value)} disabled={status === 'loading'} required />
            </label>
          </>
        )}

        <label className="desktop-field">
          <span><Mail size={13} /> Correo electronico</span>
          <input className="desktop-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={status === 'loading'} required autoComplete="email" />
        </label>

        <label className="desktop-field">
          <span><Lock size={13} /> Contrasena</span>
          <input className="desktop-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={status === 'loading'} required minLength={6} autoComplete={type === 'login' ? 'current-password' : 'new-password'} />
        </label>

        <button className="desktop-btn desktop-btn--primary" type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Procesando...' : type === 'login' ? 'Acceder al sistema' : 'Completar registro'}
          <ArrowRight size={15} />
        </button>
      </form>

      <button className="desktop-btn" onClick={() => onSwitchType(type === 'login' ? 'signup' : 'login')}>
        {type === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta'}
      </button>

      <button className="desktop-btn" onClick={onBack}>
        <ArrowLeft size={15} /> Volver al hub
      </button>
    </div>
  );
}
