export function Terms() {
  return (
    <div className="page-shell">
      <section className="hero" style={{ minHeight: 'auto', paddingBottom: '3rem' }} data-page-hero>
        <div className="hero__badge"><span className="hero__badge-dot" /> Legal</div>
        <div className="hero__glow hero__glow--rose" />
        <h1 className="hero__title" style={{ fontSize: 'clamp(2.8rem,6vw,5rem)' }}>
          Condiciones<br />del Servicio.
        </h1>
        <p className="hero__subtitle">
          Última actualización: {new Date().toLocaleDateString('es-ES')}. Las reglas del juego para mantener la comunidad Hollow Bits segura y creativa.
        </p>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="feature-grid" data-stagger style={{ gridTemplateColumns: '1fr', maxWidth: '800px', margin: '0 auto' }}>
          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--rose)' }}>1. Aceptación de los Términos</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Al acceder y utilizar Hollow Bits (incluyendo la Consola web y el Motor DAW), aceptas estar sujeto a estos Términos y Condiciones. Si no estás de acuerdo con alguna parte de los términos, no podrás acceder a nuestro servicio. Tu uso continuo de la plataforma constituye la aceptación incondicional de estos términos.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--purple)' }}>2. Propiedad Intelectual y Derechos</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Nosotros proveemos el lienzo, tú aportas el arte. <strong>Conservas todos los derechos de propiedad intelectual sobre los proyectos de audio, composiciones y samples que creas o subes a Hollow Bits.</strong> Al utilizar el servicio, nos otorgas únicamente la licencia necesaria para alojar, procesar y sincronizar tus archivos a través de nuestra infraestructura en la nube para el funcionamiento de la plataforma.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--rose)' }}>3. Conducta del Usuario</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Te comprometes a utilizar Hollow Bits con fines legales e inspiradores. Queda estrictamente prohibido:
            </p>
            <ul className="glass-card__text" style={{ paddingLeft: '1.5rem', marginTop: '1rem', listStyle: 'disc' }}>
              <li style={{ marginBottom: '0.5rem' }}>Subir material que infrinja derechos de autor de terceros.</li>
              <li style={{ marginBottom: '0.5rem' }}>Intentar vulnerar, modificar o aplicar ingeniería inversa a la arquitectura nativa del DAW o sus APIs de conexión.</li>
              <li style={{ marginBottom: '0.5rem' }}>Utilizar la plataforma para distribuir software malicioso o spam.</li>
            </ul>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7', marginTop: '1rem' }}>
              Nos reservamos el derecho de suspender o eliminar cuentas que violen estas normas.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--purple)' }}>4. Disponibilidad del Servicio</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Aunque Hollow Bits está diseñado con infraestructura de alta disponibilidad para maximizar tu tiempo de producción, el servicio se proporciona "tal cual". No garantizamos que el servicio será ininterrumpido o libre de errores en todo momento. Recomendamos mantener exportaciones locales `.esp` periódicas de tus proyectos críticos.
            </p>
          </article>

          <article className="glass-card" data-stagger-item>
            <h3 className="glass-card__title" style={{ fontSize: '1.4rem', color: 'var(--rose)' }}>5. Modificaciones</h3>
            <p className="glass-card__text" style={{ fontSize: '1.05rem', lineHeight: '1.7' }}>
              Hollow Bits evoluciona constantemente. Nos reservamos el derecho de modificar estos términos en cualquier momento. Notificaremos a los usuarios sobre cambios significativos a través del correo electrónico registrado o mediante un aviso destacado en la Consola.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
