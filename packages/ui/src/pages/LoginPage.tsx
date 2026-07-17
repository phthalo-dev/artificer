import { useState } from 'react';
import { Button, Paper, Stack, Text, TextInput, Title } from '../ds';
import { RUNTIME_URL } from '../api/client';
import { setApiKey } from '../api/auth';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/health`, {
        headers: { authorization: `Bearer ${trimmed}` },
      });
      if (res.ok) {
        setApiKey(trimmed);
        onSuccess();
      } else {
        setError('Invalid API key — check ARTIFICER_API_KEY on your runtime.');
      }
    } catch {
      setError(
        'Could not reach the server. Check your connection or VITE_RUNTIME_URL.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      <Paper p="xl" style={{ width: '100%', maxWidth: 400 }}>
        <Stack gap="md">
          <Stack gap="xs">
            <Title order={3}>Connect to Artificer</Title>
            <Text size="sm" c="dimmed">
              Enter the API key configured via <code>ARTIFICER_API_KEY</code> on
              your runtime instance.
            </Text>
          </Stack>
          <TextInput
            label="API Key"
            type="password"
            placeholder="Enter your API key"
            value={key}
            onChange={setKey}
            autoFocus
          />
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Button
            variant="filled"
            onPress={submit}
            loading={loading}
            isDisabled={!key.trim()}
          >
            Connect
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}
