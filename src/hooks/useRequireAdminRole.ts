import { useEffectiveAdminRole, type AdminRole } from '../providers/ConfigurationProvider';

const ROLE_ORDER: Record<AdminRole, number> = { none: 0, pmo_admin: 1, system_admin: 2 };

export function useRequireAdminRole(requiredRole: 'pmo_admin' | 'system_admin'): boolean {
  const currentRole = useEffectiveAdminRole();
  return ROLE_ORDER[currentRole] >= ROLE_ORDER[requiredRole];
}
