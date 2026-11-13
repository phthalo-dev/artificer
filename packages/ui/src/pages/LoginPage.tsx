import { useState, type FormEvent } from 'react';
import {
  Button,
  Center,
  Code,
  Heading,
  Stack,
  Surface,
  Text,
  TextField,
} from '@var-ui/react';
import { RUNTIME_URL } from '../api/client';
import { setApiKey } from '../api/auth';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
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
    <Center style={{ minHeight: '100vh' }}>
      <Surface padding="md" style={{ width: '100%', maxWidth: 400 }}>
        <form onSubmit={submit}>
          <Stack gap="md">
            <Stack gap="xs">
              <Heading level={3} size="md">
                Connect to Artificer
              </Heading>
              <Text size="sm" tone="secondary">
                Enter the API key configured via <Code>ARTIFICER_API_KEY</Code>{' '}
                on your runtime instance.
              </Text>
            </Stack>
            <TextField
              label="API Key"
              type="password"
              placeholder="Enter your API key"
              value={key}
              onValueChange={setKey}
              errorMessage={error ?? undefined}
              autoFocus
            />
            <Button
              type="submit"
              tone="accent"
              appearance="filled"
              loading={loading}
              disabled={!key.trim()}
            >
              Connect
            </Button>
          </Stack>
        </form>
      </Surface>
    </Center>
  );
}
