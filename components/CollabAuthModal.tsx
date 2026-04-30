import React, { useState } from 'react';
import { ShieldAlert, ArrowRight, Loader, X } from 'lucide-react';
import { supabase } from '../services/supabase';
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

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    onSuccess();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md p-8 bg-[#0b0e14] border border-white/10 rounded-sm shadow-2xl">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="auth-container" style={{ minHeight: 'auto', padding: 0 }}>
          <div className="auth-box" style={{ maxWidth: '100%' }}>
            <div className="auth-header">
              <ShieldAlert className="auth-icon" size={32} />
              <h1>Session Host</h1>
              <p>Autenticación requerida para colaborar</p>
            </div>

            {error && (
              <div className="auth-error flex items-center gap-2 p-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-sm">
                <ShieldAlert size={16} />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="producer@hollowbits.com"
                  required
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <button
                type="submit"
                className="auth-btn auth-btn-primary w-full flex items-center justify-center gap-2 mt-4"
                disabled={loading}
              >
                {loading ? <Loader className="animate-spin" size={16} /> : 'INICIAR SESIÓN'}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
