import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { errorMessage } from './format';

/** Load async data; reloads whenever the screen regains focus. Waits while `ready` is false. */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = [], ready = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(loader);
  ref.current = loader;

  const reload = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ready]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { data, error, loading, reload };
}
