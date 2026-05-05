import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Clock, LogOut, Shield } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

interface DesktopMfaChallengeProps {
  onVerified: () => void;
}

export function DesktopMfaChallenge({ onVerified }: DesktopMfaChallengeProps) {
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'fatal'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const { checkMfa, signOut } = useAuthStore();

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) {
        setStatus('fatal');
        setMessage('No se pudo obtener la configuracion 2FA.');
        return;
      }

      const verified = data?.totp?.find((factor) => factor.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
      } else {
        setStatus('fatal');
        setMessage('No se encontro un factor 2FA verificado.');
      }
    });
  }, []);

  useEffect(() => {
    const update = () => {
      const epoch = Math.floor(Date.now() / 1000);
      setTimeLeft(30 - (epoch % 30));
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!factorId) return;
    setStatus('loading');
    setMessage(null);

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) throw error;
      await checkMfa();
      onVerified();
    } catch (error) {
      console.error('[DesktopMfaChallenge] Verification failed:', error);
      setStatus('error');
      setMessage('Codigo invalido o expirado.');
      setCode('');
    }
  };

  return (
    <div className="desktop-form">
      <div className="desktop-form__header">
        <Shield size={44} color="var(--desktop-purple)" />
        <h1>Verificacion 2FA</h1>
        <p className="desktop-kicker">Inserta tu codigo TOTP para desbloquear la sesion.</p>
      </div>

      {status === 'fatal' ? (
        <>
          <div className="desktop-feedback">
            <AlertCircle size={15} /> {message}
          </div>
          <button className="desktop-btn desktop-btn--danger" onClick={() => signOut()}>
            <LogOut size={15} /> Cerrar sesion
          </button>
        </>
      ) : (
        <form onSubmit={handleVerify} style={{ display: 'grid', gap: 16 }}>
          {status === 'error' && message && (
            <div className="desktop-feedback">
              <AlertCircle size={15} /> {message}
            </div>
          )}

          <input
            className="desktop-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            maxLength={6}
            autoFocus
            style={{ height: 60, textAlign: 'center', fontSize: 28, letterSpacing: 12 }}
          />

          <div>
            <div className="desktop-row">
              <span className="desktop-meta"><Clock size={12} /> {timeLeft}s para rotacion</span>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 8 }}>
              <div style={{ height: '100%', width: `${(timeLeft / 30) * 100}%`, background: timeLeft <= 5 ? 'var(--desktop-danger)' : 'var(--desktop-purple)' }} />
            </div>
          </div>

          <button className="desktop-btn desktop-btn--primary" type="submit" disabled={status === 'loading' || code.length < 6 || !factorId}>
            {status === 'loading' ? 'Verificando...' : 'Autorizar acceso'}
            <ArrowRight size={15} />
          </button>
        </form>
      )}
    </div>
  );
}
