/**
 * Guardas de rota.
 *
 * `Protegida` exige sessao. `ExigeModulo` exige, alem da sessao, permissao no
 * modulo — assim ninguem chega numa tela por URL direta.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { Modulo } from './permissions';
import { Icon } from '@/components/ui/Icon';

function Aguardando() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <span className="spinner" style={{ width: 26, height: 26, color: 'var(--red)' }} />
      <span className="sr-only">Carregando</span>
    </div>
  );
}

export function Protegida() {
  const { usuario, carregando } = useAuth();
  const local = useLocation();

  if (carregando) return <Aguardando />;

  // Guarda de onde a pessoa tentou ir, para devolver ao lugar certo apos entrar.
  if (!usuario) return <Navigate to="/login" state={{ de: local.pathname }} replace />;

  return <Outlet />;
}

export function ExigeModulo({ modulo }: { modulo: Modulo }) {
  const { podeVer, usuario } = useAuth();

  if (podeVer(modulo)) return <Outlet />;

  return (
    <div className="pagina">
      <div className="card" style={{ maxWidth: 520, margin: '48px auto' }}>
        <div className="vazio">
          <div className="vazio-icone" style={{ background: 'var(--red-tint)', color: 'var(--red)' }}>
            <Icon nome="cadeado" />
          </div>
          <h3>Acesso restrito</h3>
          <p>
            Seu perfil <strong style={{ color: 'var(--fg-muted)' }}>{usuario?.role}</strong> não tem
            permissão para acessar esta área. Fale com um administrador se precisar deste acesso.
          </p>
        </div>
      </div>
    </div>
  );
}
