import { useEffect, useMemo, useState } from 'react';
import App from './App';
import { DesktopAuth } from './components/desktop/DesktopAuth';
import { DesktopHub } from './components/desktop/DesktopHub';
import { DesktopMfaChallenge } from './components/desktop/DesktopMfaChallenge';
import { DesktopSettings } from './components/desktop/DesktopSettings';
import { DesktopWindowChrome } from './components/desktop/DesktopWindowChrome';
import './components/desktop/DesktopShell.css';
import { useAuthStore } from './stores/authStore';

type DesktopView = 'hub' | 'login' | 'signup' | 'settings';

function getSurface(): 'hub' | 'editor' {
  const params = new URLSearchParams(window.location.search);
  const surface = params.get('surface');
  return surface === 'hub' ? 'hub' : surface === 'editor' ? 'editor' : 'hub';
}

function DesktopHubApp() {
  const [view, setView] = useState<DesktopView>('hub');
  const [refreshSignal, setRefreshSignal] = useState(0);
  const initialize = useAuthStore((state) => state.initialize);
  const handleAuthCallback = useAuthStore((state) => state.handleAuthCallback);
  const requiresMfa = useAuthStore((state) => state.requiresMfa);
  const isLoading = useAuthStore((state) => state.isLoading);

  useEffect(() => {
    const unsubscribe = initialize();
    return () => unsubscribe();
  }, [initialize]);

  useEffect(() => {
    const unsubscribeAuth = window.electron?.onAuthCallback?.((url) => {
      void handleAuthCallback(url).then((success) => {
        if (success) {
          setView('hub');
          setRefreshSignal((value) => value + 1);
        }
      });
    });

    const unsubscribeRefresh = window.electron?.onHubRefresh?.(() => {
      setRefreshSignal((value) => value + 1);
      setView('hub');
    });

    return () => {
      unsubscribeAuth?.();
      unsubscribeRefresh?.();
    };
  }, [handleAuthCallback]);

  const content = useMemo(() => {
    if (requiresMfa && !isLoading) {
      return <DesktopMfaChallenge onVerified={() => setView('hub')} />;
    }

    if (view === 'login') {
      return (
        <DesktopAuth
          type="login"
          onBack={() => setView('hub')}
          onSuccess={() => {
            setView('hub');
            setRefreshSignal((value) => value + 1);
          }}
          onSwitchType={setView}
        />
      );
    }

    if (view === 'signup') {
      return (
        <DesktopAuth
          type="signup"
          onBack={() => setView('hub')}
          onSuccess={() => {
            setView('hub');
            setRefreshSignal((value) => value + 1);
          }}
          onSwitchType={setView}
        />
      );
    }

    if (view === 'settings') {
      return <DesktopSettings onBack={() => setView('hub')} />;
    }

    return (
      <DesktopHub
        refreshSignal={refreshSignal}
        onLogin={() => setView('login')}
        onSignup={() => setView('signup')}
        onSettings={() => setView('settings')}
      />
    );
  }, [isLoading, refreshSignal, requiresMfa, view]);

  return (
    <div className="desktop-app">
      <DesktopWindowChrome />
      <div className="desktop-view">
        {content}
      </div>
    </div>
  );
}

export default function DesktopRoot() {
  const surface = getSurface();
  if (surface === 'editor') {
    return <App />;
  }

  return <DesktopHubApp />;
}
