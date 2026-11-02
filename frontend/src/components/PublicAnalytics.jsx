import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { syncPublicAnalytics } from '../utils/publicAnalytics';

const PublicAnalytics = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    syncPublicAnalytics(pathname);
  }, [pathname]);
  return null;
};

export default PublicAnalytics;
