export function Privacy() {
  return (
    <div className="page-shell">
      <section className="hero" style={{ minHeight: 'auto', paddingBottom: '3rem' }} data-page-hero>
        <div className="hero__badge"><span className="hero__badge-dot" /> Legal</div>
        <div className="hero__glow hero__glow--purple" />
        <h1 className="hero__title" style={{ fontSize: 'clamp(2.8rem,6vw,5rem)' }}>
          Política de<br />Privacidad.
        </h1>
        <p className="hero__subtitle">
          Última actualización: {new Date().toLocaleDateString('es-ES')}. Transparencia total sobre cómo manejamos tus datos en el ecosistema Hollow Bits.
        </p>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="feature-grid" data-stagger style={{ gridTemplateColumns: '1fr', maxWidth: '800px', margin: '0 auto' }}>
          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--purple)' }}>1. Información que recopilamos</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Recopilamos información básica indispensable para el funcionamiento de nuestra plataforma, incluyendo tu dirección de correo electrónico (a través de nuestro proveedor de autenticación de Supabase/Google) e información de tu perfil público. De igual manera, almacenamos los proyectos de audio, samples y metadatos que decides sincronizar con la nube de Hollow Bits.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--rose)' }}>2. Uso de tu información</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Tus datos son el combustible que permite que tu estudio sea portátil. Utilizamos tu información exclusivamente para:
            </p>
            <ul className="glass-card__text" style={{ paddingLeft: '1.5rem', marginTop: '1rem', listStyle: 'disc' }}>
              <li style={{ marginBottom: '0.5rem' }}>Proporcionar, mantener y mejorar el servicio de Hollow Bits Engine y Console.</li>
              <li style={{ marginBottom: '0.5rem' }}>Autenticar tu identidad y mantener un entorno seguro libre de intrusos.</li>
              <li style={{ marginBottom: '0.5rem' }}>Procesar y facilitar la colaboración en tiempo real con los usuarios que tú autorizas.</li>
            </ul>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--purple)' }}>3. Compartir información</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              <strong>Tu música es tuya. Tus datos también.</strong> No vendemos, alquilamos ni compartimos tu información personal o proyectos con terceros para fines comerciales. Tu información de perfil y tus archivos de audio solo son visibles para ti y para aquellos colaboradores específicos que invites explícitamente a tus sesiones.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--rose)' }}>4. Seguridad y Retención</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Implementamos protocolos de seguridad de grado industrial. Tus datos están protegidos mediante cifrado en tránsito y en reposo, apoyados por las estrictas políticas de Row Level Security (RLS) en nuestra base de datos. Garantizamos que absolutamente nadie puede acceder a un proyecto sin tener el rol adecuado asignado por el propietario.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--purple)' }}>5. Contacto</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Si tienes preguntas, inquietudes o deseas ejercer tus derechos sobre tus datos, nuestro equipo está a tu entera disposición. Escríbenos directamente a: <strong style={{ color: 'var(--text)' }}>steamdusk@gmail.com</strong>
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
