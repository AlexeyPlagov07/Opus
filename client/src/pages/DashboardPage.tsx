/**
 * Dashboard page route wrapper.
 *
 * Keeps route-level composition separate from dashboard feature UI.
 */
import Dashboard from '../components/Dashboard';

/**
 * Renders the authenticated dashboard page.
 *
 * @returns Dashboard feature component.
 */
export default function DashboardPage(): JSX.Element {
  return <Dashboard />;
}
