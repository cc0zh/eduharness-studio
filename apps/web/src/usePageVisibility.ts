import { useEffect, useState } from 'react';

export function usePageVisibility() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    function update() {
      setVisible(document.visibilityState === 'visible');
    }
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
