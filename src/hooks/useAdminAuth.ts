import { useCallback, useEffect, useState } from 'react';

interface SessionResponse {
  authenticated: boolean;
}

interface LoginInput {
  username: string;
  password: string;
}

async function parseAuthResponse(response: Response): Promise<SessionResponse> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message || 'Falha na autentica\u00e7\u00e3o.');
  }

  return (await response.json()) as SessionResponse;
}

export function useAdminAuth() {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setIsChecking(true);

    try {
      const response = await fetch('/api/admin/session', {
        credentials: 'same-origin',
      });
      const data = await parseAuthResponse(response);
      setIsAuthenticated(data.authenticated);
      setError(null);
    } catch {
      setIsAuthenticated(false);
      setError('N\u00e3o foi poss\u00edvel validar a sess\u00e3o do admin.');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(async ({ username, password }: LoginInput) => {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });

    const data = await parseAuthResponse(response);
    setIsAuthenticated(data.authenticated);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      setIsAuthenticated(false);
    }
  }, []);

  return {
    isChecking,
    isAuthenticated,
    error,
    login,
    logout,
    loadSession,
  };
}
